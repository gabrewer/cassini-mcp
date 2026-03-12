import * as p from '@clack/prompts'
import * as path from 'path'
import { c, icons, box, termWidth, fixedWidth, leftRight, formatElapsed, SPINNER_FRAMES } from '../ui/theme.js'
import { Dashboard } from '../ui/dashboard.js'
import { readPrd } from '../lib/prd.js'
import {
  ensureDotDir,
  loadState,
  saveState,
  getLogPath,
  newRunState,
  ensureTaskState,
  isTaskDone,
} from '../lib/state.js'
import type { Task } from '../lib/prd.js'
import type { RunState, TaskState, TaskStatus } from '../lib/state.js'

type AgentName = 'test-writer' | 'backend-builder' | 'frontend-builder' | 'code-reviewer' | 'git-committer' | 'pm'

const TASK_AGENTS: Record<string, AgentName[]> = {
  backend:  ['test-writer', 'backend-builder'],
  frontend: ['test-writer', 'frontend-builder'],
  both:     ['test-writer', 'backend-builder', 'frontend-builder'],
}

const REVIEWER: AgentName = 'code-reviewer'
const COMMITTER: AgentName = 'git-committer'
const PM: AgentName = 'pm'

const MAX_REVIEW_ATTEMPTS = 6

// --- GitHub issue tracking ---

async function loadTaskIssues(): Promise<Record<string, number>> {
  const file = Bun.file(path.join(process.cwd(), '.claude', 'task-issues.json'))
  if (!(await file.exists())) return {}
  try { return await file.json() } catch { return {} }
}

async function setIssueStatus(
  issueNum: number,
  emoji: '🏃' | '✋' | '✅',
  checkOffItems = false,
): Promise<void> {
  try {
    // Update title: strip existing leading emoji + space, prepend new one
    const titleJson = await Bun.spawn(
      ['gh', 'issue', 'view', String(issueNum), '--json', 'title'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const titleText = await new Response(titleJson.stdout).text()
    await titleJson.exited
    const current = (JSON.parse(titleText) as { title: string }).title
    const stripped = current.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/u, '')
    await Bun.spawn(
      ['gh', 'issue', 'edit', String(issueNum), '--title', `${emoji} ${stripped}`],
      { stdout: 'pipe', stderr: 'pipe' },
    ).exited

    // Check off acceptance criteria checkboxes when done
    if (checkOffItems) {
      const bodyJson = await Bun.spawn(
        ['gh', 'issue', 'view', String(issueNum), '--json', 'body'],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const bodyText = await new Response(bodyJson.stdout).text()
      await bodyJson.exited
      const body = (JSON.parse(bodyText) as { body: string }).body
      const checked = body.replace(/- \[ \]/g, '- [x]')
      if (checked !== body) {
        await Bun.spawn(
          ['gh', 'issue', 'edit', String(issueNum), '--body', checked],
          { stdout: 'pipe', stderr: 'pipe' },
        ).exited
      }
    }
  } catch {
    // Non-fatal — issue tracking should never block the build
  }
}

interface ActiveTaskDisplay {
  taskId: string
  agent: AgentName
  attempt: number
  status: string
  bytesWritten: number
  startedAt: string
}

// Claude's analysis of which tasks depend on which
interface ExecutionPlan {
  dependencies: Record<string, string[]>  // taskId -> taskIds it depends on
  reasoning: string
}

export async function runCommand(argv: string[]): Promise<void> {
  const resume = argv.includes('--resume')
  const yes = argv.includes('--yes')

  const branchFlagIdx = argv.indexOf('--branch')
  const branchFlag = branchFlagIdx !== -1 ? argv[branchFlagIdx + 1] : undefined

  let prd
  try {
    prd = await readPrd()
  } catch (err) {
    console.error(c.error(String(err instanceof Error ? err.message : err)))
    process.exit(1)
  }

  ensureDotDir()

  let state: RunState
  if (resume) {
    const existing = await loadState()
    if (!existing) {
      console.error(c.error('No previous run found. Start without --resume.'))
      process.exit(1)
    }
    state = existing
    console.log(c.muted(`Resuming run ${state.runId} (${state.sprint})`))
  } else {
    const branch = await getCurrentBranch()
    const safeBranch = await ensureSafeBranch(branch, branchFlag)
    state = newRunState(prd.sprint, safeBranch)
  }

  for (const task of prd.tasks) {
    ensureTaskState(state, task.id)
  }
  await saveState(state)

  // Serialise all state writes — concurrent tasks share the same state object
  // and write to the same file. Queue ensures no interleaved writes.
  let saveQueue = Promise.resolve()
  const enqueueSave = () => {
    saveQueue = saveQueue.then(() => saveState(state))
    return saveQueue
  }

  // Plan before the dashboard starts. Approval loop lets the user review and
  // optionally provide feedback to revise before execution begins.
  const pendingTasks = prd.tasks.filter(task => !isTaskDone(state, task.id))

  let plan = await runPlanSpinner(pendingTasks)
  let waves = buildWaves(pendingTasks, plan.dependencies)

  printPlan(waves, plan.reasoning)

  if (!yes) {
    while (true) {
      const answer = await p.text({
        message: 'Proceed with this plan?',
        placeholder: 'enter to confirm, or describe changes…',
      })

      if (p.isCancel(answer)) {
        p.cancel('Cancelled.')
        process.exit(0)
      }

      const feedback = typeof answer === 'string' ? answer.trim() : ''
      if (!feedback) break  // confirmed — proceed

      plan = await runPlanSpinner(pendingTasks, feedback)
      waves = buildWaves(pendingTasks, plan.dependencies)
      printPlan(waves, plan.reasoning)
      // loop back to show revised plan and prompt again
    }
  }

  console.log('')

  const dashboard = new Dashboard()
  // keyed by `${taskId}:${agent}` so parallel agents are all visible
  const activeAgents = new Map<string, ActiveTaskDisplay>()
  let currentWave = 1  // planning is done; first wave is about to start

  const cleanup = () => {
    dashboard.stop()
    dashboard.showCursor()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  const renderDashboard = () => buildDashboard(prd.sprint, state, prd.tasks, activeAgents, dashboard, waves, currentWave, plan.reasoning)
  dashboard.start(renderDashboard)

  const taskIssues = await loadTaskIssues()

  // Execute waves in sequence. Tasks within each wave run in parallel.
  for (const wave of waves) {
    currentWave++
    await Promise.allSettled(
      wave.map(task => runTask(state, task, activeAgents, enqueueSave, taskIssues))
    )
  }

  // PM summary after all tasks settle
  const pmDisplay: ActiveTaskDisplay = {
    taskId: 'sprint', agent: PM, attempt: 1,
    status: 'Writing sprint summary...', bytesWritten: 0, startedAt: new Date().toISOString(),
  }
  activeAgents.set('sprint:pm', pmDisplay)
  await runAgent(
    state.runId,
    { id: 'sprint', title: prd.sprint, type: 'both', description: prd.description, acceptanceCriteria: [] },
    PM, 1, pmDisplay,
  )
  activeAgents.delete('sprint:pm')

  const finalContent = buildDashboard(prd.sprint, state, prd.tasks, activeAgents, dashboard, waves, currentWave, plan.reasoning)
  dashboard.stop(finalContent)

  const doneCount = prd.tasks.filter(t => isTaskDone(state, t.id)).length
  const failedCount = prd.tasks.length - doneCount
  console.log('')
  if (failedCount === 0) {
    console.log(c.success(`  ${icons.done}  All ${doneCount} tasks complete.`))
  } else {
    console.log(c.warning(`  ${icons.done}  ${doneCount} done, ${c.error(`${failedCount} failed`)}.  Check .agentloop/logs/ for details.`))
  }
  console.log('')
}

async function runTask(
  state: RunState,
  task: Task,
  activeAgents: Map<string, ActiveTaskDisplay>,
  enqueueSave: () => Promise<void>,
  taskIssues: Record<string, number> = {},
): Promise<void> {
  const issueNum = taskIssues[task.id]
  const ts = state.tasks[task.id]
  ts.status = 'testing'
  ts.startedAt = new Date().toISOString()
  enqueueSave()
  if (issueNum) setIssueStatus(issueNum, '🏃')

  // test-writer always runs first, alone
  const twDisplay: ActiveTaskDisplay = {
    taskId: task.id, agent: 'test-writer', attempt: 1,
    status: 'Writing tests...', bytesWritten: 0, startedAt: new Date().toISOString(),
  }
  activeAgents.set(`${task.id}:test-writer`, twDisplay)
  await runAgent(state.runId, task, 'test-writer', 1, twDisplay)
  activeAgents.delete(`${task.id}:test-writer`)

  // builders: sequential for single-type tasks, parallel for 'both'
  ts.status = 'building'
  enqueueSave()
  const builders = (TASK_AGENTS[task.type] ?? TASK_AGENTS.backend).filter(a => a !== 'test-writer')
  await Promise.all(builders.map(async (agent) => {
    const display: ActiveTaskDisplay = {
      taskId: task.id, agent, attempt: 1,
      status: 'Building...', bytesWritten: 0, startedAt: new Date().toISOString(),
    }
    activeAgents.set(`${task.id}:${agent}`, display)
    await runAgent(state.runId, task, agent, 1, display)
    activeAgents.delete(`${task.id}:${agent}`)
  }))

  // review → rebuild cycle
  ts.status = 'reviewing'
  enqueueSave()

  let approved = false
  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    ts.attempts = attempt
    const reviewDisplay: ActiveTaskDisplay = {
      taskId: task.id, agent: REVIEWER, attempt,
      status: attempt === 1 ? 'Reviewing...' : `Re-reviewing (attempt ${attempt})...`,
      bytesWritten: 0, startedAt: new Date().toISOString(),
    }
    activeAgents.set(`${task.id}:${REVIEWER}`, reviewDisplay)
    enqueueSave()

    const result = await runAgent(state.runId, task, REVIEWER, attempt, reviewDisplay)
    activeAgents.delete(`${task.id}:${REVIEWER}`)

    if (result.approved) {
      approved = true
      break
    }

    ts.lastFeedback = result.feedback

    if (attempt < MAX_REVIEW_ATTEMPTS) {
      ts.status = 'building'
      const rebuildAgents = (TASK_AGENTS[task.type] ?? TASK_AGENTS.backend).filter(a => a !== 'test-writer')
      await Promise.all(rebuildAgents.map(async (agent) => {
        const display: ActiveTaskDisplay = {
          taskId: task.id, agent, attempt: attempt + 1,
          status: 'Fixing feedback...', bytesWritten: 0, startedAt: new Date().toISOString(),
        }
        activeAgents.set(`${task.id}:${agent}`, display)
        await runAgent(state.runId, task, agent, attempt + 1, display, ts.lastFeedback)
        activeAgents.delete(`${task.id}:${agent}`)
      }))
      ts.status = 'reviewing'
      enqueueSave()
    }
  }

  if (!approved) {
    ts.status = 'failed'
    ts.completedAt = new Date().toISOString()
    enqueueSave()
    if (issueNum) setIssueStatus(issueNum, '✋')
    return
  }

  ts.status = 'committed'
  enqueueSave()
  const commitDisplay: ActiveTaskDisplay = {
    taskId: task.id, agent: COMMITTER, attempt: 1,
    status: 'Committing...', bytesWritten: 0, startedAt: new Date().toISOString(),
  }
  activeAgents.set(`${task.id}:${COMMITTER}`, commitDisplay)
  await runAgent(state.runId, task, COMMITTER, 1, commitDisplay)
  activeAgents.delete(`${task.id}:${COMMITTER}`)

  ts.status = 'done'
  ts.completedAt = new Date().toISOString()
  enqueueSave()
  if (issueNum) setIssueStatus(issueNum, '✅', true)
}

interface AgentResult {
  approved: boolean
  feedback?: string
}

interface AgentDef {
  systemPrompt: string
  model: string
  tools: string[]
}

async function loadAgentDef(agent: AgentName): Promise<AgentDef> {
  const filePath = path.join(process.cwd(), '.claude', 'agents', `${agent}.md`)
  const content = await Bun.file(filePath).text()

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) return { systemPrompt: content.trim(), model: 'sonnet', tools: [] }

  const [, frontmatter, body] = fmMatch
  const modelMatch = frontmatter.match(/^model:\s*(.+)$/m)
  const toolsMatch = frontmatter.match(/^tools:\s*(.+)$/m)

  return {
    systemPrompt: body.trim(),
    model: modelMatch ? modelMatch[1].trim() : 'sonnet',
    tools: toolsMatch ? toolsMatch[1].split(',').map(t => t.trim()) : [],
  }
}

function buildAgentPrompt(task: Task, agent: AgentName, lastFeedback?: string): string {
  const criteria = task.acceptanceCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n')

  const base = `# Task: ${task.id} — ${task.title}\n\n${task.description}\n\n## Acceptance Criteria\n${criteria}`

  if (lastFeedback && (agent === 'backend-builder' || agent === 'frontend-builder')) {
    return `${base}\n\n## Code Review Feedback to Address\n${lastFeedback}`
  }

  if (agent === REVIEWER && lastFeedback) {
    return `${base}\n\n## Previous Review Feedback (verify these issues were addressed)\n${lastFeedback}`
  }

  return base
}

async function runPlanSpinner(tasks: Task[], feedback?: string): Promise<ExecutionPlan> {
  const label = feedback ? 'Revising plan…' : 'Planning execution order…'
  let frame = 0
  const spinner = setInterval(() => {
    process.stdout.write(`\r  ${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]}  ${c.muted(label)}`)
  }, 80)
  const plan = await planExecution(tasks, feedback)
  clearInterval(spinner)
  process.stdout.write('\r' + ' '.repeat(55) + '\r')
  return plan
}

function printPlan(waves: Task[][], reasoning: string): void {
  const width = Math.min(termWidth(), 80)
  console.log('')
  console.log(c.muted('  ' + box.divider(width - 4)))
  console.log(`  ${c.brand(icons.logo)}  ${c.bold('Execution plan')}`)
  if (reasoning) console.log(c.muted(`  ${reasoning}`))
  console.log('')
  waves.forEach((wave, i) => {
    const parallel = wave.length > 1 ? c.muted('  parallel') : ''
    console.log(`  ${c.brand(`wave ${i + 1}`)}${parallel}`)
    wave.forEach(t => console.log(`    ${c.muted('·')}  ${c.bold(t.id)}  ${t.title}`))
    if (i < waves.length - 1) console.log(c.muted('      ↓'))
  })
  console.log('')
  console.log(c.muted('  ' + box.divider(width - 4)))
  console.log('')
}

async function planExecution(tasks: Task[], feedback?: string): Promise<ExecutionPlan> {
  const taskList = tasks.map(t =>
    `- ${t.id}: ${t.title}\n  ${t.description}\n  Acceptance criteria: ${t.acceptanceCriteria.join('; ')}`
  ).join('\n')

  const systemPrompt = `You are an execution planner for a software build loop.
Given a list of tasks, identify which tasks depend on others and must run after them.
Respond with ONLY a JSON object — no markdown, no explanation outside the JSON:
{
  "dependencies": {
    "TASK-001": [],
    "TASK-002": ["TASK-001"]
  },
  "reasoning": "one sentence"
}
Rules:
- A task depends on another only if it requires types, entities, or infrastructure that the other task creates
- If tasks touch completely different domains/files, they have no dependency
- Keep the graph minimal — only add edges that are truly necessary`

  const userPrompt = feedback
    ? `Tasks to plan:\n${taskList}\n\nUser feedback on previous plan: ${feedback}\nRevise the plan accordingly.`
    : `Tasks to plan:\n${taskList}`

  const env = { ...process.env }
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE_SSE_PORT']
  delete env['CLAUDE_CODE_ENTRYPOINT']

  const proc = Bun.spawn([
    'claude', '-p', userPrompt,
    '--system-prompt', systemPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'sonnet',
    '--dangerously-skip-permissions',
    '--allowedTools', '',   // no tools — pure reasoning only
  ], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env })

  let resultText = ''
  const decoder = new TextDecoder()
  let lineBuffer = ''

  for await (const chunk of proc.stdout) {
    lineBuffer += decoder.decode(chunk)
    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === 'result' && event.subtype === 'success') resultText = event.result ?? ''
      } catch { /* partial */ }
    }
  }
  const stderrText = await new Response(proc.stderr).text()
  await proc.exited

  // Debug: write raw planner output so failures are diagnosable
  await Bun.write('.agentloop/planner-debug.log',
    `=== stdout (resultText) ===\n${resultText}\n\n=== stderr ===\n${stderrText}\n`
  )

  // Extract the JSON object — robust against preamble text or code fences
  const jsonMatch = resultText.match(/\{[\s\S]*\}/)
  const json = jsonMatch ? jsonMatch[0] : ''

  try {
    const plan = JSON.parse(json) as ExecutionPlan
    // Ensure every task has an entry, even if the planner omitted it
    for (const t of tasks) {
      if (!plan.dependencies[t.id]) plan.dependencies[t.id] = []
    }
    return plan
  } catch {
    const reason = stderrText.trim()
      ? `planner error: ${stderrText.trim().slice(0, 120)}`
      : `planner returned invalid JSON: ${json.slice(0, 120) || '(empty)'}`
    return {
      dependencies: Object.fromEntries(tasks.map(t => [t.id, []])),
      reasoning: `fallback — ${reason}`,
    }
  }
}

// Topological sort into waves. Tasks in the same wave have no dependencies on each other
// and all their dependencies were satisfied in prior waves.
function buildWaves(tasks: Task[], dependencies: Record<string, string[]>): Task[][] {
  const waves: Task[][] = []
  const completed = new Set<string>()
  const remaining = new Map(tasks.map(t => [t.id, t]))

  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter(t =>
      (dependencies[t.id] ?? []).every(dep => completed.has(dep))
    )

    if (wave.length === 0) {
      // Circular dependency or dep references unknown task — dump the rest in one wave
      waves.push([...remaining.values()])
      break
    }

    waves.push(wave)
    wave.forEach(t => { completed.add(t.id); remaining.delete(t.id) })
  }

  return waves
}

function statusFromEvent(event: Record<string, unknown>): string | null {
  if (event.type === 'tool_use') {
    const name = String(event.name ?? '')
    const input = (event.input ?? {}) as Record<string, unknown>
    const detail =
      (input.command as string) ??
      (input.file_path as string) ??
      (input.pattern as string) ??
      (input.description as string) ??
      ''
    const truncated = detail.length > 60 ? detail.slice(0, 59) + '…' : detail
    return truncated ? `${name}: ${truncated}` : name
  }

  if (event.type === 'assistant') {
    const msg = event.message as Record<string, unknown> | undefined
    const content = Array.isArray(msg?.content) ? msg.content : []
    for (const block of content) {
      if ((block as Record<string, unknown>).type === 'text') {
        const text = String((block as Record<string, unknown>).text ?? '').trim()
        if (text) return text.length > 70 ? text.slice(0, 69) + '…' : text
      }
    }
  }

  return null
}

async function runAgent(
  runId: string,
  task: Task,
  agent: AgentName,
  attempt: number,
  display: ActiveTaskDisplay,
  lastFeedback?: string
): Promise<AgentResult> {
  const logPath = getLogPath(runId, task.id, agent, agent === REVIEWER ? attempt : undefined)
  const def = await loadAgentDef(agent)
  const userPrompt = buildAgentPrompt(task, agent, lastFeedback)

  const args = [
    'claude', '-p', userPrompt,
    '--system-prompt', def.systemPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ]
  if (def.tools.length > 0) args.push('--allowedTools', def.tools.join(','))
  if (def.model) args.push('--model', def.model)

  // Strip Claude Code session markers so subprocesses aren't blocked as nested sessions
  const env = { ...process.env }
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE_SSE_PORT']
  delete env['CLAUDE_CODE_ENTRYPOINT']

  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })

  let rawOutput = ''
  let resultText = ''
  const decoder = new TextDecoder()
  let lineBuffer = ''

  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk)
    rawOutput += text
    display.bytesWritten = rawOutput.length
    lineBuffer += text

    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        const status = statusFromEvent(event)
        if (status) display.status = status
        if (event.type === 'result' && event.subtype === 'success') {
          resultText = event.result ?? ''
        }
      } catch { /* partial line */ }
    }
  }

  // drain any final partial line
  if (lineBuffer.trim()) {
    try {
      const event = JSON.parse(lineBuffer)
      const status = statusFromEvent(event)
      if (status) display.status = status
      if (event.type === 'result' && event.subtype === 'success') {
        resultText = event.result ?? ''
      }
    } catch { /* incomplete */ }
  }

  const stderrText = await new Response(proc.stderr).text()
  await proc.exited
  const combined = rawOutput + (stderrText ? `\n--- STDERR ---\n${stderrText}` : '')
  await Bun.write(logPath, combined)

  if (agent === REVIEWER) {
    const approved = /SHIP IT/i.test(resultText)
    return { approved, feedback: approved ? undefined : resultText }
  }

  return { approved: true }
}

function buildDashboard(
  sprintName: string,
  state: RunState,
  tasks: Task[],
  activeAgents: Map<string, ActiveTaskDisplay>,
  dashboard: Dashboard,
  waves: Task[][] = [],
  currentWave = 0,
  reasoning = '',
): string {
  const width = termWidth()
  const lines: string[] = []

  const doneCount = tasks.filter(t => isTaskDone(state, t.id)).length
  const headerLeft  = `  ${c.brand(icons.logo + ' agentloop')}           ${c.bold(sprintName)}`
  const waveStr = waves.length > 1 ? `wave ${currentWave}/${waves.length}  ` : ''
  const headerRight = `${waveStr}${doneCount} / ${tasks.length} tasks done  `
  const branchLine  = `  Branch: ${c.brand(state.branch)}`

  lines.push(box.top(width, ''))
  lines.push(leftRight(headerLeft, c.muted(headerRight), width))
  lines.push(leftRight(branchLine, '', width))
  if (reasoning) {
    const maxLen = width - 6
    const truncated = reasoning.length > maxLen ? reasoning.slice(0, maxLen - 1) + '…' : reasoning
    lines.push(c.muted(`  Plan: ${truncated}`))
  }
  lines.push(box.bottom(width))
  lines.push('')

  const idWidth    = 10
  const timeWidth  = 9
  const titleWidth = Math.max(10, width - idWidth - timeWidth - 6)

  // Build a taskId → wave index map for the subheaders
  const taskWave = new Map<string, number>()
  waves.forEach((wave, i) => wave.forEach(t => taskWave.set(t.id, i + 1)))

  // Render tasks grouped by wave when there are multiple waves
  const renderTask = (task: Task) => {
    const ts: TaskState | undefined = state.tasks[task.id]
    const status = ts?.status ?? 'pending'
    const elapsed = formatElapsed(ts?.startedAt)
    const isActive = [...activeAgents.keys()].some(k => k.startsWith(`${task.id}:`))
    const { icon, colorFn } = taskAppearance(status, isActive ? dashboard.nextFrame() : undefined)
    lines.push(`   ${icon}  ${c.muted(fixedWidth(task.id, idWidth))}  ${colorFn(fixedWidth(task.title, titleWidth))}  ${c.muted(elapsed)}`)
  }

  if (waves.length > 1) {
    waves.forEach((wave, i) => {
      const waveNum = i + 1
      const isCurrentWave = waveNum === currentWave
      const waveLabel = waveNum < currentWave ? `wave ${waveNum}` : isCurrentWave ? `wave ${waveNum}  ←` : `wave ${waveNum}  (blocked)`
      lines.push(c.muted(`  ${waveLabel}`))
      wave.forEach(renderTask)
      lines.push('')
    })
  } else {
    tasks.forEach(renderTask)
    lines.push('')
  }

  lines.push('')
  lines.push(c.muted('  ' + box.divider(width - 4)))

  if (activeAgents.size === 0) {
    lines.push(c.muted('  Idle'))
  } else {
    for (const active of activeAgents.values()) {
      const spinFrame = dashboard.nextFrame()
      const attemptStr = active.agent === REVIEWER ? c.muted(` attempt ${active.attempt}/${MAX_REVIEW_ATTEMPTS}`) : ''
      const kb = active.bytesWritten > 0 ? `${Math.ceil(active.bytesWritten / 1024)}KB` : ''
      const elapsed = formatElapsed(active.startedAt)
      const statusWidth = Math.max(10, width - 75)
      const statusText = fixedWidth(active.status, statusWidth)
      const left = `  ${c.bold(fixedWidth(active.taskId, 10))}  ${c.brand(fixedWidth(active.agent, 18))}${attemptStr}  ${c.brand(spinFrame)}  ${c.task(statusText)}`
      const right = c.muted(`${kb}  ${elapsed}  `)
      lines.push(leftRight(left, right, width))
    }
  }

  lines.push(c.muted('  ' + box.divider(width - 4)))

  return lines.join('\n')
}

function taskAppearance(
  status: TaskStatus,
  spinnerFrame?: string
): { icon: string; colorFn: (s: string) => string } {
  switch (status) {
    case 'done':
      return { icon: c.success(icons.done), colorFn: c.muted }
    case 'failed':
      return { icon: c.error(icons.failed), colorFn: c.error }
    case 'pending':
      return { icon: c.muted(icons.pending), colorFn: c.muted }
    default:
      return {
        icon: c.brand(spinnerFrame ?? icons.pending),
        colorFn: c.task,
      }
  }
}

async function getCurrentBranch(): Promise<string> {
  const proc = Bun.spawn(['git', 'branch', '--show-current'], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.trim() || 'main'
}

async function ensureSafeBranch(branch: string, branchFlag?: string): Promise<string> {
  if (branch !== 'main' && branch !== 'master') return branch

  if (branchFlag) {
    console.log(c.muted(`  Using branch: ${branchFlag}`))
    return branchFlag
  }

  console.log('')
  console.log(c.warning(`  You're on ${c.bold(branch)}. The build loop should run on a feature branch.`))
  console.log('')

  const newBranch = await p.text({
    message: 'Feature branch name',
    placeholder: 'feature/sprint-1',
    validate: (val) => (!val ? 'Branch name is required.' : undefined),
  })

  if (p.isCancel(newBranch)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  return newBranch as string
}
