import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Database } from "bun:sqlite";
import { join } from "path";
import { z } from "zod";

// Open the shared SQLite database relative to this package (mcp/../cassini.db)
const DB_PATH = join(import.meta.dir, "..", "..", "cassini.db");
const db = new Database(DB_PATH);

// Keep a reference so tools added later can use it
export { db };

// Initialise the MCP server
const server = new McpServer({
  name: "cassini-mcp",
  version: "0.1.0",
});

// ─── Tool: get_flybys ─────────────────────────────────────────────────────────

server.registerTool(
  "get_flybys",
  {
    description:
      "Returns the count and dates of targeted flyby encounter events for a given body " +
      "in the Cassini mission master plan (rows where the title matches 'targeted flyby', " +
      "equivalent to the ENTAR request class for Enceladus and similar patterns for other moons).",
    inputSchema: z.object({
      target: z.string().describe("Name of the target body, e.g. 'Enceladus' or 'Titan'"),
    }),
  },
  async ({ target }) => {
    // Parameterised query: target = ?
    const stmt = db.prepare(
      `SELECT date FROM master_plan WHERE lower(title) LIKE '%targeted%flyby%' AND target = ? ORDER BY start_time_utc`
    );
    const rows = stmt.all(target) as Array<{ date: string }>;
    const result = { count: rows.length, dates: rows.map((r) => r.date) };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ─── Tool: get_observations ───────────────────────────────────────────────────

server.registerTool(
  "get_observations",
  {
    description:
      "Returns rows from the Cassini master_plan observation schedule. Supports optional " +
      "filtering by target body, instrument team, and UTC date range. Includes the full " +
      "description field. Default limit is 50 rows.",
    inputSchema: z.object({
      target: z
        .string()
        .optional()
        .describe("Filter by target body name, e.g. 'Titan'"),
      team: z
        .string()
        .optional()
        .describe("Filter by instrument team acronym, e.g. 'CIRS' or 'ISS'"),
      date_range: z
        .tuple([z.string(), z.string()])
        .optional()
        .describe("UTC date range [start, end] in YYYY-DDDTHH:MM:SS format"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of rows to return (default 50)"),
    }),
  },
  async ({ target, team, date_range, limit = 50 }) => {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (target !== undefined) {
      conditions.push("target = ?");
      params.push(target);
    }
    if (team !== undefined) {
      conditions.push("team = ?");
      params.push(team);
    }
    if (date_range !== undefined) {
      conditions.push("start_time_utc >= ? AND start_time_utc <= ?");
      params.push(date_range[0], date_range[1]);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const sql =
      `SELECT id, start_time_utc, duration, date, team, target, ` +
      `request_name, title, description FROM master_plan ${where} ` +
      `ORDER BY start_time_utc LIMIT ?`;
    const rows = db.prepare(sql).all(...params);

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
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
      name: z.string().describe("Exact name of the body, e.g. 'Enceladus' or 'Saturn'"),
    }),
  },
  async ({ name }) => {
    // Parameterised: name = ?  (no embedded string literals in SQL before the ?)
    const row = db.prepare(`SELECT name, type, radius_km, mass_kg, discoverer, notes FROM planets WHERE name = ?`).get(name);

    return {
      content: [{ type: "text", text: JSON.stringify(row ?? null, null, 2) }],
    };
  }
);

// ─── Tool: get_team_stats ─────────────────────────────────────────────────────

server.registerTool(
  "get_team_stats",
  {
    description:
      "Returns the total observation count and combined duration for each instrument team " +
      "in the Cassini mission master plan, sorted by observation count descending.",
    inputSchema: z.object({}),
  },
  async () => {
    const rows = db
      .prepare(
        `SELECT team, COUNT(*) AS observation_count, SUM(duration) AS total_duration ` +
        `FROM master_plan GROUP BY team ORDER BY observation_count DESC`
      )
      .all();

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

// ─── Tool: get_mission_timeline ───────────────────────────────────────────────

server.registerTool(
  "get_mission_timeline",
  {
    description:
      "Returns Cassini observation activity over time. Without a year, returns total " +
      "observation count per year for the whole mission. With a year, returns a monthly " +
      "breakdown for that year.",
    inputSchema: z.object({
      year: z.number().optional().describe("Optional year (e.g. 2005) for monthly breakdown"),
    }),
  },
  async ({ year }) => {
    const rows = year
      ? db
          .prepare(
            `SELECT substr(start_time_utc, 6, 2) AS month, COUNT(*) AS observation_count ` +
            `FROM master_plan WHERE substr(start_time_utc, 1, 4) = ? ` +
            `GROUP BY month ORDER BY month`
          )
          .all(String(year))
      : db
          .prepare(
            `SELECT substr(start_time_utc, 1, 4) AS year, COUNT(*) AS observation_count ` +
            `FROM master_plan GROUP BY year ORDER BY year`
          )
          .all();

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

// ─── Tool: get_targets ────────────────────────────────────────────────────────

server.registerTool(
  "get_targets",
  {
    description:
      "Returns all distinct observation targets in the Cassini master plan with their " +
      "total observation counts, sorted by count descending. Useful for orientation and " +
      "understanding which bodies received the most scientific attention.",
    inputSchema: z.object({}),
  },
  async () => {
    const rows = db
      .prepare(
        `SELECT target, COUNT(*) AS observation_count ` +
        `FROM master_plan GROUP BY target ORDER BY observation_count DESC`
      )
      .all();

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

// Connect over stdio — this keeps the process alive waiting for JSON-RPC messages
const transport = new StdioServerTransport();

// Explicitly resume stdin so the event loop stays alive when stdin is a pipe
// (Bun may not keep the loop running on a data listener alone)
process.stdin.resume();

await server.connect(transport);
