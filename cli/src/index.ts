/**
 * cli/src/index.ts — Cassini CLI entry point
 *
 * Usage:
 *   bun run src/index.ts <question> [--llm anthropic|openai] [--pretty] [--help]
 */

import {
  openDb,
  getFlybys,
  getObservations,
  getBodySummary,
  getTeamStats,
  getMissionTimeline,
  getTargets,
} from "../../shared/db.ts";
import { AnthropicDriver } from "./drivers/anthropic.ts";
import { OpenAIDriver } from "./drivers/openai.ts";
import type { QueryIntent } from "./drivers/types.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

type LLMProvider = "anthropic" | "openai";

const VALID_LLM_PROVIDERS: LLMProvider[] = ["anthropic", "openai"];

const SCHEMA_CONTEXT = `
Tables:
  master_plan — Cassini observation schedule
    columns: id, start_time_utc, duration, date, team, spass_type, target, request_name, title, description
  planets — celestial body metadata
    columns: id, name, type, parent_body, distance_from_sun_km, orbital_period_days, radius_km, mass_kg, discovered_date, discoverer, notes
`.trim();

// ── API key env var names ──────────────────────────────────────────────────────

const API_KEY_VARS: Record<LLMProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

// ── Arg parsing ────────────────────────────────────────────────────────────────

interface ParsedArgs {
  question: string | null;
  pretty: boolean;
  llm: LLMProvider;
  help: boolean;
  /** Non-null when a user-facing validation error occurred. */
  error: string | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = executable, argv[1] = script path — skip both
  const args = argv.slice(2);

  let question: string | null = null;
  let pretty = false;
  let help = false;
  let error: string | null = null;
  let llmFromFlag: LLMProvider | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--pretty") {
      pretty = true;
    } else if (arg === "--llm") {
      const val = args[++i];
      if (!val) {
        error = "Error: --llm requires a value (anthropic or openai)";
      } else if (!(VALID_LLM_PROVIDERS as string[]).includes(val)) {
        error = `Error: invalid --llm value '${val}'. Must be one of: ${VALID_LLM_PROVIDERS.join(", ")}`;
      } else {
        llmFromFlag = val as LLMProvider;
      }
    } else if (!arg.startsWith("--")) {
      // First bare positional argument is the question
      if (question === null) {
        question = arg;
      }
    }
  }

  // --llm flag takes highest priority; CASSINI_LLM env var overrides built-in default
  let llm: LLMProvider = "anthropic";
  const envLlm = process.env.CASSINI_LLM;
  if (envLlm && (VALID_LLM_PROVIDERS as string[]).includes(envLlm)) {
    llm = envLlm as LLMProvider;
  }
  if (llmFromFlag !== null) {
    llm = llmFromFlag;
  }

  return { question, pretty, llm, help, error };
}

// ── Usage ──────────────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(
    `Usage: bun run src/index.ts <question> [options]

Ask a question about the Cassini mission dataset.

Arguments:
  question           The natural-language question to answer (required)

Options:
  --llm <provider>   LLM provider: anthropic or openai  (default: anthropic)
  --pretty           Pretty-print the output with formatting
  --help, -h         Print this help message and exit

Environment:
  CASSINI_LLM        Default LLM provider (overridden by --llm flag)
  ANTHROPIC_API_KEY  Required when using the anthropic provider
  OPENAI_API_KEY     Required when using the openai provider

Examples:
  bun run src/index.ts "How many Enceladus flybys did Cassini perform?"
  bun run src/index.ts "Which team made the most observations?" --llm openai --pretty`
  );
}

// ── Query execution ────────────────────────────────────────────────────────────

/**
 * Dispatches a QueryIntent to the appropriate database query function.
 * Returns the raw result (array of rows or a single object).
 */
export async function executeQueryIntent(intent: QueryIntent): Promise<unknown> {
  switch (intent.type) {
    case "get_flybys":
      return getFlybys(intent.params.target);
    case "get_observations":
      return getObservations(intent.params);
    case "get_body_summary":
      return getBodySummary(intent.params.name);
    case "get_team_stats":
      return getTeamStats();
    case "get_mission_timeline":
      return intent.params.year !== undefined
        ? getMissionTimeline(intent.params.year)
        : getMissionTimeline();
    case "get_targets":
      return getTargets();
  }
}

// ── Output formatting ─────────────────────────────────────────────────────────

/**
 * Formats query result data for display.
 * pretty=false → compact JSON on one line.
 * pretty=true  → indented JSON for human readability.
 */
export function formatResult(data: unknown, pretty: boolean): string {
  if (pretty) {
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

// ── Error handling ─────────────────────────────────────────────────────────────

/**
 * Returns a user-friendly error message for routing or DB failures.
 * Uses only err.message — never includes stack trace lines or file paths.
 */
export function handleRoutingError(err: unknown, question: string): string {
  const message = err instanceof Error ? err.message : String(err);
  return `Could not understand or answer your question: "${question}"\nError: ${message}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  if (!parsed.question) {
    console.error("Error: a question is required.");
    console.error(
      "Usage: bun run src/index.ts <question> [--llm anthropic|openai] [--pretty]"
    );
    console.error("Run with --help for full usage information.");
    process.exit(1);
  }

  // Validate API key before making any network calls
  const apiKey = process.env[API_KEY_VARS[parsed.llm]] ?? null;
  if (!apiKey) {
    const varName = API_KEY_VARS[parsed.llm];
    console.error(
      `Error: ${varName} is not set. Please export ${varName} before running.`
    );
    process.exit(1);
  }

  // Verify DB is reachable before making any network calls
  const db = openDb();
  db.close();

  const driver =
    parsed.llm === "anthropic"
      ? new AnthropicDriver(apiKey)
      : new OpenAIDriver(apiKey);

  let intent: QueryIntent;
  try {
    intent = await driver.ask(parsed.question, SCHEMA_CONTEXT);
  } catch (err) {
    console.error(handleRoutingError(err, parsed.question));
    process.exit(1);
  }

  let result: unknown;
  try {
    result = await executeQueryIntent(intent);
  } catch (err) {
    console.error(handleRoutingError(err, parsed.question));
    process.exit(1);
  }

  console.log(formatResult(result, parsed.pretty));
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal error: ${message}`);
    process.exit(1);
  });
}
