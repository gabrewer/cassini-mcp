# Plan: MCP Server

## Overview

A focused MCP server that exposes the Cassini mission database as 6 typed tools, enabling an AI to answer natural language questions about flybys, observations, instrument teams, mission targets, and moon/planet facts. This is the MCP half of the cassini-mcp comparison demo.

Target reader: a developer learning MCP who wants a real-world example showing how tool design shapes AI reasoning.

## Decisions

- **Flyby signal:** `request_name = 'ENTAR'` — targeted flyby events only
- **Description field:** included in full (not truncated)
- **Transport:** stdio only (local demo)
- **CLI:** separate sprint in `cli/`
- **Observations limit:** default 50 rows, optional override

## Tasks

### task-001: MCP server scaffolding

**Description:** Create the `mcp/` directory with `package.json` (Bun project, `@modelcontextprotocol/sdk` dependency), `tsconfig.json`, and `src/index.ts` with MCP server initialisation, stdio transport, and a working SQLite database connection to `../cassini.db`. Server must start cleanly with `bun run dev`.

**Acceptance Criteria:**
- `mcp/package.json` exists with `@modelcontextprotocol/sdk` dependency
- `mcp/src/index.ts` initialises an MCP server with stdio transport
- Database connection opens `../cassini.db` relative to `mcp/`
- `bun run dev` from `mcp/` starts without error
- No tools registered yet — server starts and stays running

### task-002: Core tools

**Description:** Implement four tools on the MCP server: `get_flybys(target: string)` returning flyby count + dates using `request_name = 'ENTAR'`; `get_observations(target?, team?, date_range?, limit?)` returning filtered master_plan rows; `get_body_summary(name: string)` returning planet/moon facts from the planets table; `get_team_stats()` returning observation count and total duration per instrument team.

**Acceptance Criteria:**
- `get_flybys("Enceladus")` returns exactly 23 targeted flyby events
- `get_observations({ target: "Titan" })` returns up to 50 rows with correct fields
- `get_body_summary("Enceladus")` returns radius, mass, discoverer, notes
- `get_team_stats()` returns all teams sorted by observation count descending
- All tools have descriptions precise enough for a model to choose correctly
- All queries use parameterised inputs — no string interpolation

### task-003: Additional tools

**Description:** Implement two more tools: `get_mission_timeline(year?: number)` returning observation activity grouped by year (or detailed breakdown for a specific year); `get_targets()` returning all distinct target names with observation counts, sorted by count descending.

**Acceptance Criteria:**
- `get_mission_timeline()` returns a row per year with observation count
- `get_mission_timeline(2005)` returns monthly breakdown for 2005
- `get_targets()` returns all distinct targets with counts, sorted descending
- Saturn appears at the top of `get_targets()` results
