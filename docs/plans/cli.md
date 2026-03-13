# Plan: CLI

## Overview

A natural-language CLI that lets you query cassini.db by asking plain English questions — `cassini-cli "how many flybys of Enceladus?"`. The CLI routes the question through a configurable LLM (Anthropic or OpenAI), which maps it to one of the 6 query types already defined by the MCP server, then executes the query and returns JSON (or pretty-printed output with `--pretty`). This is the CLI half of the MCP-vs-CLI comparison: same data, same query capabilities, different architecture.

Building this also forces the extraction of shared database logic into `shared/db.ts`, which both the MCP server and CLI will import. That extraction is task-001 and must land first.

## Decisions

- **Input model**: Single positional argument — a natural language question. No subcommands, no REPL, no conversation history. Stateless per invocation.
- **Output**: JSON by default. `--pretty` flag for human-readable formatting.
- **LLM routing**: The LLM receives the question plus schema context and returns a `QueryIntent` — a discriminated union matching the 6 MCP tool names exactly (`get_flybys`, `get_observations`, `get_body_summary`, `get_team_stats`, `get_mission_timeline`, `get_targets`). The CLI executes the intent against the DB. No raw SQL fallback — unknown intent returns a clear error message.
- **Configurable LLM**: `--llm anthropic|openai` flag or `CASSINI_LLM` env var. Defaults to `anthropic`.
- **API keys**: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` env vars. CLI exits with a clear error if the selected provider's key is missing.
- **Shared DB module**: `shared/db.ts` at project root level (not a monorepo package). Exports `openDb()`, `utcDateExpr`, and typed query functions for all 6 tool queries. MCP server updated to import from here too.

## Tasks

### task-001: shared/db.ts — extract shared database logic

**Description:** Create `shared/db.ts` (and `shared/types.ts` if needed) exporting `openDb()`, the `utcDateExpr` SQL fragment, and typed query functions for all 6 operations: `getFlybys`, `getObservations`, `getBodySummary`, `getTeamStats`, `getMissionTimeline`, `getTargets`. Each function takes the same parameters as the corresponding MCP tool and returns typed results. All date filtering must use `start_time_utc` via `utcDateExpr` — never the `date` column.

**Acceptance Criteria:**
- `shared/db.ts` exists and exports `openDb`, `utcDateExpr`, and 6 query functions
- `openDb()` connects to `cassini.db` at the project root using a path relative to the caller or an absolute resolved path
- `getFlybys('Enceladus')` returns exactly 23 results
- `getObservations({ target: 'Titan' })` returns up to 50 rows by default
- `getTeamStats()` returns rows sorted by observation count descending
- `getTargets()` returns Saturn at the top
- `getMissionTimeline()` returns one row per year; `getMissionTimeline(2005)` returns monthly breakdown
- `bun test shared/` exits 0 with all tests passing

### task-002: CLI scaffolding — package.json, arg parsing, entry point

**Description:** Create `cli/package.json` (Bun project), `cli/tsconfig.json`, and `cli/src/index.ts`. The entry point parses a positional question argument plus `--pretty`, `--llm anthropic|openai`, and `--help` flags. With `--help` it prints usage and exits 0. With no question it prints an error and exits 1. The CLI should import `openDb` from `shared/db.ts` to verify the DB connection works. Wire a placeholder for the LLM routing step (stub that returns a hard-coded QueryIntent for now) so the scaffold is runnable end-to-end.

**Acceptance Criteria:**
- `cli/package.json` exists with a `bin` or `dev` script
- `bun run cli/src/index.ts --help` prints usage and exits 0
- `bun run cli/src/index.ts` (no args) prints an error message and exits 1
- `bun run cli/src/index.ts "test question"` runs without crashing (stub response is fine)
- `--pretty` flag is parsed and changes output formatting
- `--llm` flag accepts `anthropic` or `openai`; rejects other values

### task-003: LLM drivers — Anthropic and OpenAI implementations

**Description:** Create `cli/src/drivers/types.ts` defining the `LlmDriver` interface: a single method that takes a question string and schema context, returns a `QueryIntent`. Create `cli/src/drivers/anthropic.ts` and `cli/src/drivers/openai.ts` implementing the interface. Each driver calls its respective API with a system prompt that includes the database schema and the 6 valid intent types, asks the model to return a JSON `QueryIntent`, and parses the response. The `QueryIntent` type is a discriminated union with `type` matching one of the 6 tool names and `params` matching that tool's parameters. Must run after task-002.

**Acceptance Criteria:**
- `cli/src/drivers/types.ts` exports `LlmDriver` interface and `QueryIntent` discriminated union type
- `QueryIntent` has exactly 6 variants matching the MCP tool names: `get_flybys`, `get_observations`, `get_body_summary`, `get_team_stats`, `get_mission_timeline`, `get_targets`
- `cli/src/drivers/anthropic.ts` exports a class implementing `LlmDriver`
- `cli/src/drivers/openai.ts` exports a class implementing `LlmDriver`
- Both drivers include database schema context in the system prompt
- Both drivers parse the LLM response into a typed `QueryIntent` or throw a descriptive error
- TypeScript compiles with no errors: `bunx tsc --noEmit` from `cli/` exits 0

### task-004: Query routing and execution — wire LLM to DB

**Description:** Replace the stub in `cli/src/index.ts` with real routing: select the LLM driver based on `--llm` flag or `CASSINI_LLM` env var (default: `anthropic`), call the driver with the user's question, receive a `QueryIntent`, execute the matching query function from `shared/db.ts`, and print the result as JSON (or pretty-printed with `--pretty`). Handle errors gracefully: missing API key → clear message with the env var name; unknown intent from LLM → "I couldn't understand that question" with the original question echoed back; DB errors → message without stack trace. Must run after task-001, task-002, and task-003.

**Acceptance Criteria:**
- Running `cassini-cli "how many flybys of Enceladus?"` with a valid API key returns JSON containing 23 flybys
- `--pretty` flag produces human-readable output (not raw JSON)
- Missing `ANTHROPIC_API_KEY` when using `--llm anthropic` prints a message mentioning `ANTHROPIC_API_KEY` and exits 1
- Missing `OPENAI_API_KEY` when using `--llm openai` prints a message mentioning `OPENAI_API_KEY` and exits 1
- `CASSINI_LLM=openai` env var selects the OpenAI driver without needing `--llm`
- `--llm` flag overrides the `CASSINI_LLM` env var
- Unknown/unparseable LLM response returns a user-friendly error, not a stack trace

### task-005: Update MCP server to import from shared/db.ts

**Description:** Refactor `mcp/src/index.ts` to import query functions from `shared/db.ts` instead of containing its own SQL queries. The MCP tool handlers should call the shared functions and format the results for MCP responses. All 6 tools must continue to work identically. This task must run after task-001 (shared/db.ts exists) and after the mcp-server sprint is complete.

**Acceptance Criteria:**
- `mcp/src/index.ts` imports from `../shared/db.ts` (or equivalent path)
- No SQL query strings remain in `mcp/src/index.ts` — all queries come from shared functions
- `get_flybys('Enceladus')` still returns exactly 23 results through the MCP server
- `get_team_stats()` still returns teams sorted by count descending through the MCP server
- `bun run dev` from `mcp/` still starts without error
- All existing MCP tool behavior is preserved (no regressions)
