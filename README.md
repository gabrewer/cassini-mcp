# Cassini MCP vs CLI — An Experiment in AI Grounding

> **The question:** Does giving an AI agent a structured MCP server produce better answers than letting it query a SQLite database directly through a CLI tool? This repo is the test bench.

The [Cassini–Huygens mission](https://saturn.jpl.nasa.gov/) produced 13 years of meticulously planned observations around the Saturn system. Its master plan — tens of thousands of scheduled observations — is now a SQLite database. It's rich, real, and domain-specific enough that a model can't fake its way through it. That makes it an ideal subject for comparing two approaches to grounding AI agents in structured data.

---

## What's in This Repo

| Path | What it is |
|------|-----------|
| `cassini.db` | SQLite database of Cassini mission data |
| `mcp/` | MCP server exposing Cassini data as tools |
| `cli/` | CLI tool for querying Cassini data directly |
| `loop/` | The `agentloop` orchestrator that built this project |
| `prd.json` | Product requirements driving the build |
| `.claude/agents/` | Agent definitions (test-writer, builder, reviewer, etc.) |

---

## The Dataset: `cassini.db`

Two tables. All real data.

### `master_plan` — 61,873 rows

Every observation scheduled during Cassini's orbital tour, from April 2005 through the Grand Finale on September 15, 2016.

| Column | Description |
|--------|-------------|
| `id` | Auto-increment primary key |
| `start_time_utc` | Observation start time |
| `duration` | Length of observation (format: `DDDThh:mm:ss`) |
| `date` | Calendar date (e.g. `15-Jan-05`) |
| `team` | Instrument team (CIRS, UVIS, ISS, VIMS, INMS, …) |
| `spass_type` | Observation sub-type classification |
| `target` | Target body (Saturn, Titan, Enceladus, rings, …) |
| `request_name` | Short internal identifier |
| `title` | Human-readable observation title |
| `description` | Full science description |

**Top targets by observation count:** Saturn (16,958), Titan (9,503), Rings (5,808), Enceladus (1,626), Rhea (964), Dione (780), Iapetus (682).

**Top instrument teams:** CIRS (11,969), UVIS (9,208), ISS (8,989), VIMS (6,376), INMS (4,747).

### `planets` — 6 rows

Reference data for the Saturn system bodies visited by Cassini.

| Column | Description |
|--------|-------------|
| `name` | Body name (Saturn, Titan, Enceladus, Iapetus, Rhea, Mimas) |
| `type` | `planet` or `moon` |
| `parent_body` | Parent body (Saturn for all moons) |
| `radius_km` | Mean radius in kilometers |
| `mass_kg` | Mass in kilograms |
| `orbital_period_days` | Orbital period |
| `discoverer` | Who found it |
| `discovered_date` | Discovery date |
| `notes` | Notable characteristics |

---

## Setup

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- [Claude Desktop](https://claude.ai/download) (for MCP) or any MCP-compatible client
- The `cassini.db` file (included in this repo)

### MCP Server

The MCP server exposes Cassini data as callable tools an AI agent can invoke during a conversation.

```bash
cd mcp
bun install
bun run dev          # development mode with --watch
bun run build        # compile to dist/cassini-mcp
```

Register in Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cassini": {
      "command": "bun",
      "args": ["run", "/path/to/session-7/mcp/src/index.ts"]
    }
  }
}
```

Restart Claude Desktop. The Cassini tools will appear in the tool picker.

### CLI Tool

The CLI tool lets a model (or a human) query the database directly from the command line.

```bash
cd cli
bun install
bun run dev --help   # see available commands
bun run build        # compile to dist/cassini-cli
```

Basic usage:

```bash
# Ask a question in plain language
./cassini-cli ask "How many times did Cassini observe Enceladus?"

# Query a specific target
./cassini-cli target enceladus --limit 10

# Summarise a moon
./cassini-cli moon titan
```

---

## Example Questions

These questions are answerable from the actual data in `cassini.db`. Try them against both implementations.

**1. How many observations targeted Enceladus, and which instrument teams led them?**
> Enceladus appears 1,626 times in `master_plan`. Knowing which teams dominated — and what the observations were named — tells you something about the scientific focus of each flyby.

**2. What was Cassini observing in the week before the Grand Finale?**
> The mission ended September 15, 2016. The `master_plan` records run up to that date. What targets, durations, and teams appear in those final days?

**3. Which moon has the most observations, and how does that compare to its radius?**
> Titan (9,503 observations, radius 2,574 km) vs. Enceladus (1,626 observations, radius 252 km). The `planets` table supplies the physical stats; `master_plan` supplies the count.

**4. Which instrument team had the most total observation time, and what was their primary target?**
> CIRS leads with 11,969 scheduled observations. Summing `duration` and grouping by `team` and `target` gives a picture of how science time was allocated.

**5. Compare the moons discovered by Giovanni Cassini vs. those discovered by William Herschel — what do their observation counts look like?**
> Iapetus and Rhea (both Cassini, 1671–1672) vs. Enceladus and Mimas (both Herschel, 1789). Cross `planets.discoverer` with `master_plan` target counts.

---

## How to Compare

The goal isn't to benchmark raw query speed — it's to understand how the interface shapes the quality of AI reasoning.

### What to observe

| Dimension | MCP | CLI |
|-----------|-----|-----|
| **Tool transparency** | Agent explicitly calls named tools; you see each call | Agent writes and runs SQL; intent is less visible |
| **Error handling** | Tool schema enforces valid inputs before execution | SQL errors surface at runtime |
| **Follow-up questions** | Agent can chain tool calls within one turn | Each question may require a new invocation |
| **Prompt engineering** | Tool descriptions guide the agent | System prompt and examples do the work |
| **Hallucination surface** | Constrained by tool outputs | Constrained by query results |

### Suggested workflow

1. Pick one of the five example questions above.
2. Ask it in Claude Desktop with the MCP server active. Note the tools called, the intermediate steps, and the final answer.
3. Run the same question through the CLI tool (or ask a model to use the CLI). Note the SQL generated and the answer.
4. Compare: Which answer was more accurate? Which path was more transparent? Which was easier to correct when wrong?

There's no right answer — the experiment is the point.

---

## About `agentloop`

This project was built by `agentloop`, a lightweight Claude-powered build orchestrator living in the `loop/` directory. It reads a `prd.json`, spins up specialist agents (test-writer, backend-builder, code-reviewer, git-committer), and drives them through a review cycle until the work ships. The README you're reading was written by the backend-builder agent during the first sprint.

See `ORCHESTRATION.md` for how the pipeline works, and `.claude/agents/` for the agent definitions.

---

## Further Reading

- [Model Context Protocol specification](https://modelcontextprotocol.io/introduction) — the protocol powering the MCP server
- [MCP SDK for TypeScript](https://github.com/modelcontextprotocol/typescript-sdk) — `@modelcontextprotocol/sdk`
- [Cassini mission archive](https://pds-rings.seti.org/cassini/) — source of the raw data
- [Saturn Observation Campaign](https://saturn.jpl.nasa.gov/) — mission overview at JPL
