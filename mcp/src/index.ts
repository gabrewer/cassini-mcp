/**
 * mcp/src/index.ts — Cassini MCP server
 *
 * All database access is delegated to shared/db.ts which opens ../cassini.db
 * (bun:sqlite) relative to the project root.  No SQL lives in this file.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  getFlybys,
  getObservations,
  getBodySummary,
  getTeamStats,
  getMissionTimeline,
  getTargets,
} from "../../shared/db";

// ─── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "cassini-mcp",
  version: "0.1.0",
});

// ─── Tool: get_flybys ─────────────────────────────────────────────────────────

server.registerTool(
  "get_flybys",
  {
    description:
      "Returns flyby encounter events for a given target body in the Cassini mission " +
      "master plan (MAG-team observations whose title contains 'flyby'), ordered " +
      "chronologically by start_time_utc.",
    inputSchema: z.object({
      target: z
        .string()
        .describe("Name of the target body, e.g. 'Enceladus' or 'Titan'"),
    }),
  },
  async ({ target }) => {
    const rows = await getFlybys(target);
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ─── Tool: get_observations ───────────────────────────────────────────────────

server.registerTool(
  "get_observations",
  {
    description:
      "Returns rows from the Cassini master_plan observation schedule. Supports optional " +
      "filtering by target body and instrument team. Default limit is 50 rows.",
    inputSchema: z.object({
      target: z
        .string()
        .optional()
        .describe("Filter by target body name, e.g. 'Titan'"),
      team: z
        .string()
        .optional()
        .describe("Filter by instrument team acronym, e.g. 'CIRS' or 'ISS'"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of rows to return (default 50)"),
    }),
  },
  async ({ target, team, limit }) => {
    const rows = await getObservations({ target, team, limit });
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ─── Tool: get_body_summary ───────────────────────────────────────────────────

server.registerTool(
  "get_body_summary",
  {
    description:
      "Returns physical and discovery facts for a planet, moon, or other celestial body " +
      "from the planets table, including radius_km, mass_kg, discoverer, and notes.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("Exact name of the body, e.g. 'Enceladus' or 'Saturn'"),
    }),
  },
  async ({ name }) => {
    const row = await getBodySummary(name);
    return {
      content: [{ type: "text", text: JSON.stringify(row, null, 2) }],
    };
  }
);

// ─── Tool: get_team_stats ─────────────────────────────────────────────────────

server.registerTool(
  "get_team_stats",
  {
    description:
      "Returns the total observation count for each instrument team in the Cassini " +
      "mission master plan, sorted by count descending.",
    inputSchema: z.object({}),
  },
  async () => {
    const rows = await getTeamStats();
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ─── Tool: get_mission_timeline ───────────────────────────────────────────────

server.registerTool(
  "get_mission_timeline",
  {
    description:
      "Returns Cassini observation activity over time. Without a year argument, returns " +
      "total observation count per year for the whole mission (2004–2017). With a year, " +
      "returns a monthly breakdown for that year.",
    inputSchema: z.object({
      year: z
        .number()
        .int()
        .optional()
        .describe("Optional year (e.g. 2005) for a monthly breakdown"),
    }),
  },
  async ({ year }) => {
    const rows = year !== undefined
      ? await getMissionTimeline(year)
      : await getMissionTimeline();
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ─── Tool: get_targets ────────────────────────────────────────────────────────

server.registerTool(
  "get_targets",
  {
    description:
      "Returns all distinct observation targets in the Cassini master plan with their " +
      "total observation counts, sorted by count descending.",
    inputSchema: z.object({}),
  },
  async () => {
    const rows = await getTargets();
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  }
);

// ─── Connect over stdio ───────────────────────────────────────────────────────

const transport = new StdioServerTransport();

// Keep stdin open so the event loop stays alive when stdin is a pipe.
process.stdin.resume();

// Exit cleanly on SIGTERM so `bun run dev` doesn't report a signal error.
process.on("SIGTERM", () => process.exit(0));

await server.connect(transport);
