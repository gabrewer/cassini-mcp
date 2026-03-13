/**
 * Tests for task-005: MCP server imports from shared/db.ts
 *
 * AC1: mcp/src/index.ts imports from ../shared/db.ts (or equivalent path)
 * AC2: No SQL query strings remain in mcp/src/index.ts — all queries live in shared/db.ts
 * AC3: get_flybys('Enceladus') returns exactly 23 results through the MCP server
 * AC4: get_team_stats() returns teams sorted by count descending through the MCP server
 * AC5: bun run dev from mcp/ still starts without error
 * AC6: All 6 MCP tools respond without errors (no regressions)
 *
 * All tests MUST fail before the implementation exists.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const MCP_DIR = join(PROJECT_ROOT, "mcp");
const MCP_INDEX = join(MCP_DIR, "src", "index.ts");

// ─── AC1: mcp/src/index.ts imports from shared/db ────────────────────────────

describe("AC1 – mcp/src/index.ts imports from shared/db.ts", () => {
  let source: string;

  beforeAll(() => {
    // This will throw if the file doesn't exist — all tests in this suite fail
    source = readFileSync(MCP_INDEX, "utf-8");
  });

  test("src/index.ts exists", () => {
    expect(existsSync(MCP_INDEX)).toBe(true);
  });

  test("imports from a path containing 'shared/db'", () => {
    // Must import from ../shared/db or ../../shared/db or equivalent
    expect(source).toMatch(/from\s+['"].*shared\/db['"]/);
  });

  test("uses at least one named import from shared/db", () => {
    // Should destructure specific function names: { getFlybys, getTeamStats, ... }
    expect(source).toMatch(/import\s*\{[^}]+\}\s*from\s+['"].*shared\/db['"]/);
  });

  test("imports getFlybys from shared/db", () => {
    expect(source).toMatch(/\bgetFlybys\b/);
  });

  test("imports getTeamStats from shared/db", () => {
    expect(source).toMatch(/\bgetTeamStats\b/);
  });
});

// ─── AC2: No raw SQL query strings in mcp/src/index.ts ───────────────────────

describe("AC2 – no SQL query strings remain in mcp/src/index.ts", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(MCP_INDEX, "utf-8");
  });

  test("no SELECT statement in source", () => {
    // All queries belong in shared/db.ts; mcp/src/index.ts must not define its own
    expect(source).not.toMatch(/\bSELECT\b/);
  });

  test("no FROM master_plan clause in source", () => {
    expect(source).not.toMatch(/FROM\s+master_plan/i);
  });

  test("no GROUP BY clause in source", () => {
    expect(source).not.toMatch(/GROUP\s+BY/i);
  });

  test("no raw db.query() calls in source", () => {
    // The MCP index should call shared functions, not execute SQLite queries directly
    expect(source).not.toMatch(/\bdb\.query\s*</);
  });

  test("no WHERE team = 'MAG' literal in source", () => {
    // Flyby logic must live entirely inside shared/db.ts
    expect(source).not.toMatch(/team\s*=\s*['"]MAG['"]/);
  });
});

// ─── MCP JSON-RPC helper ──────────────────────────────────────────────────────

interface McpContentItem {
  type: string;
  text: string;
}

interface McpToolResult {
  content: McpContentItem[];
  isError?: boolean;
}

/**
 * Spawns the MCP server, runs the full MCP initialize handshake, calls one
 * tool, and returns the result.  Kills the server process before resolving.
 */
async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<McpToolResult> {
  const proc = Bun.spawn([process.execPath, "run", "dev"], {
    cwd: MCP_DIR,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function sendLine(msg: object): void {
    proc.stdin.write(encoder.encode(JSON.stringify(msg) + "\n"));
    proc.stdin.flush();
  }

  try {
    // Step 1 – initialize (MCP handshake)
    sendLine({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    // Brief pause to let the server process the initialize request
    await new Promise((r) => setTimeout(r, 150));

    // Step 2 – confirm client is initialized
    sendLine({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

    // Step 3 – call the tool
    sendLine({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    });

    // Step 4 – read stdout lines until we see the response with id=2
    const deadline = Date.now() + timeoutMs;
    let buffer = "";

    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk);

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete trailing line

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not JSON — skip (server may emit non-JSON debug lines)
        }

        if (msg.id === 2) {
          if (msg.error) {
            throw new Error(`MCP error response: ${JSON.stringify(msg.error)}`);
          }
          return msg.result as McpToolResult;
        }
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Timeout (${timeoutMs}ms) waiting for MCP tool response: ${toolName}`
        );
      }
    }

    throw new Error(
      `MCP server stdout closed before responding to tool call: ${toolName}`
    );
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
  }
}

/**
 * Extracts an array of data rows from an MCP tool result.
 *
 * Handles two common patterns:
 *   1. Single text content item whose text is a JSON-stringified array.
 *   2. Multiple content items, each representing one row (each text is JSON).
 *
 * Returns [] if neither pattern matches.
 */
function extractRows(result: McpToolResult): unknown[] {
  if (!result.content || result.content.length === 0) return [];

  // Pattern 1: single content item with JSON array text
  if (result.content.length === 1) {
    const text = result.content[0].text ?? "";
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to pattern 2
    }
  }

  // Pattern 2: many content items — try to parse each as a JSON object/row
  const rows: unknown[] = [];
  for (const item of result.content) {
    try {
      rows.push(JSON.parse(item.text));
    } catch {
      rows.push(item.text);
    }
  }
  return rows;
}

// ─── AC3: get_flybys('Enceladus') returns exactly 23 results via MCP ─────────

describe("AC3 – get_flybys('Enceladus') returns 23 results via MCP server", () => {
  test(
    "tool call returns a non-error result",
    async () => {
      const result = await callMcpTool("get_flybys", { target: "Enceladus" });
      expect(result).toBeDefined();
      expect(result.isError).not.toBe(true);
      expect(Array.isArray(result.content)).toBe(true);
    },
    25_000
  );

  test(
    "returns exactly 23 flyby records for Enceladus",
    async () => {
      const result = await callMcpTool("get_flybys", { target: "Enceladus" });
      const rows = extractRows(result);
      expect(rows).toHaveLength(23);
    },
    25_000
  );

  test(
    "each flyby row has target='Enceladus', team='MAG', and a title containing 'flyby'",
    async () => {
      const result = await callMcpTool("get_flybys", { target: "Enceladus" });
      const rows = extractRows(result) as Array<{
        target: string;
        team: string;
        title: string;
      }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.target).toBe("Enceladus");
        expect(row.team).toBe("MAG");
        expect(row.title.toLowerCase()).toContain("flyby");
      }
    },
    25_000
  );

  test(
    "get_flybys for an unknown body returns an empty result",
    async () => {
      const result = await callMcpTool("get_flybys", { target: "Pluto" });
      expect(result.isError).not.toBe(true);
      const rows = extractRows(result);
      expect(rows).toHaveLength(0);
    },
    25_000
  );

  test(
    "rows are ordered chronologically by start_time_utc",
    async () => {
      const result = await callMcpTool("get_flybys", { target: "Enceladus" });
      const rows = extractRows(result) as Array<{ start_time_utc: string }>;
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1].start_time_utc <= rows[i].start_time_utc).toBe(true);
      }
    },
    25_000
  );
});

// ─── AC4: get_team_stats() returns teams sorted by count descending via MCP ───

describe("AC4 – get_team_stats() sorted by count descending via MCP server", () => {
  test(
    "tool call returns a non-error result",
    async () => {
      const result = await callMcpTool("get_team_stats", {});
      expect(result).toBeDefined();
      expect(result.isError).not.toBe(true);
    },
    25_000
  );

  test(
    "returns multiple teams",
    async () => {
      const result = await callMcpTool("get_team_stats", {});
      const rows = extractRows(result);
      expect(rows.length).toBeGreaterThan(1);
    },
    25_000
  );

  test(
    "each row has a 'team' string and 'count' number",
    async () => {
      const result = await callMcpTool("get_team_stats", {});
      const rows = extractRows(result) as Array<{ team: string; count: number }>;
      for (const row of rows) {
        expect(typeof row.team).toBe("string");
        expect(typeof row.count).toBe("number");
        expect(row.count).toBeGreaterThan(0);
      }
    },
    25_000
  );

  test(
    "teams are sorted by count descending (each entry ≥ the next)",
    async () => {
      const result = await callMcpTool("get_team_stats", {});
      const rows = extractRows(result) as Array<{ team: string; count: number }>;
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i - 1].count).toBeGreaterThanOrEqual(rows[i].count);
      }
    },
    25_000
  );

  test(
    "CIRS is the first team (highest observation count = 11969)",
    async () => {
      const result = await callMcpTool("get_team_stats", {});
      const rows = extractRows(result) as Array<{ team: string; count: number }>;
      expect(rows[0].team).toBe("CIRS");
      expect(rows[0].count).toBe(11969);
    },
    25_000
  );
});

// ─── AC5: bun run dev starts cleanly ─────────────────────────────────────────
// (This supplements the AC4+AC5 tests in task-001-mcp-scaffolding.test.ts with
//  an import-aware check: the server must start even after the refactor.)

describe("AC5 – bun run dev starts cleanly after shared/db.ts refactor", () => {
  test(
    "server process stays alive for ≥ 3 s (does not crash on import)",
    async () => {
      const proc = Bun.spawn([process.execPath, "run", "dev"], {
        cwd: MCP_DIR,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });

      let exited = false;
      const exitPromise = proc.exited.then(() => { exited = true; });

      await Promise.race([
        exitPromise,
        new Promise((r) => setTimeout(r, 3_000)),
      ]);

      if (!exited) {
        proc.kill();
        await proc.exited.catch(() => {});
      }

      expect(exited).toBe(false);
    },
    10_000
  );

  test(
    "no module-not-found or import errors in stderr",
    async () => {
      const proc = Bun.spawn([process.execPath, "run", "dev"], {
        cwd: MCP_DIR,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });

      const decoder = new TextDecoder();
      let stderr = "";
      const collect = (async () => {
        for await (const chunk of proc.stderr) {
          stderr += decoder.decode(chunk);
        }
      })();

      await new Promise((r) => setTimeout(r, 2_000));
      proc.kill();
      await proc.exited.catch(() => {});

      const fatalPatterns = [
        /Cannot find module/,
        /Module not found/,
        /SyntaxError/,
        /TypeError/,
        /ReferenceError/,
        /ENOENT/,
        /error:/i,
      ];
      for (const pattern of fatalPatterns) {
        expect(stderr).not.toMatch(pattern);
      }
    },
    10_000
  );
});

// ─── AC6: All 6 MCP tools respond without regression ─────────────────────────

describe("AC6 – all 6 MCP tools respond without error (regression check)", () => {
  const tools: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "get_flybys", args: { target: "Titan" } },
    { name: "get_observations", args: {} },
    { name: "get_body_summary", args: { name: "Saturn" } },
    { name: "get_team_stats", args: {} },
    { name: "get_mission_timeline", args: {} },
    { name: "get_targets", args: {} },
  ];

  for (const { name, args } of tools) {
    test(
      `'${name}' responds with content and no error`,
      async () => {
        const result = await callMcpTool(name, args);
        expect(result.isError).not.toBe(true);
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
      },
      25_000
    );
  }

  test(
    "get_observations respects a 'limit' argument",
    async () => {
      const result = await callMcpTool("get_observations", { limit: 5 });
      expect(result.isError).not.toBe(true);
      const rows = extractRows(result);
      expect(rows.length).toBeLessThanOrEqual(5);
    },
    25_000
  );

  test(
    "get_body_summary for Saturn returns radius_km as a number",
    async () => {
      const result = await callMcpTool("get_body_summary", { name: "Saturn" });
      expect(result.isError).not.toBe(true);
      const rows = extractRows(result);
      // Summary may return a single object rather than an array
      const body =
        Array.isArray(rows) && rows.length > 0
          ? rows[0]
          : (() => {
              const text = result.content[0]?.text ?? "";
              try {
                return JSON.parse(text);
              } catch {
                return null;
              }
            })();
      expect(body).not.toBeNull();
      expect(typeof (body as { radius_km: number }).radius_km).toBe("number");
    },
    25_000
  );

  test(
    "get_mission_timeline (no args) returns 14 years (2004–2017)",
    async () => {
      const result = await callMcpTool("get_mission_timeline", {});
      expect(result.isError).not.toBe(true);
      const rows = extractRows(result);
      expect(rows).toHaveLength(14);
    },
    25_000
  );

  test(
    "get_targets returns Saturn as the top target (16958 observations)",
    async () => {
      const result = await callMcpTool("get_targets", {});
      expect(result.isError).not.toBe(true);
      const rows = extractRows(result) as Array<{ target: string; count: number }>;
      expect(rows[0].target).toBe("Saturn");
      expect(rows[0].count).toBe(16958);
    },
    25_000
  );
});
