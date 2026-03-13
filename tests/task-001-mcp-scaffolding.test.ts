/**
 * Tests for task-001: MCP server scaffolding
 *
 * These tests verify the acceptance criteria for the mcp/ directory scaffold.
 * All tests MUST fail before the implementation exists.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { Database } from "bun:sqlite";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const MCP_DIR = join(PROJECT_ROOT, "mcp");
const MCP_PKG = join(MCP_DIR, "package.json");
const MCP_TSCONFIG = join(MCP_DIR, "tsconfig.json");
const MCP_INDEX = join(MCP_DIR, "src", "index.ts");

// ─── AC1: package.json exists with @modelcontextprotocol/sdk ─────────────────

describe("AC1 – mcp/package.json", () => {
  test("file exists", () => {
    expect(existsSync(MCP_PKG)).toBe(true);
  });

  test("is valid JSON", () => {
    const raw = readFileSync(MCP_PKG, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("has @modelcontextprotocol/sdk in dependencies", () => {
    const pkg = JSON.parse(readFileSync(MCP_PKG, "utf-8"));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(Object.keys(allDeps)).toContain("@modelcontextprotocol/sdk");
  });

  test("has a 'dev' script", () => {
    const pkg = JSON.parse(readFileSync(MCP_PKG, "utf-8"));
    expect(pkg.scripts?.dev).toBeTruthy();
  });

  test("dev script references src/index.ts or equivalent entry point", () => {
    const pkg = JSON.parse(readFileSync(MCP_PKG, "utf-8"));
    const devScript: string = pkg.scripts?.dev ?? "";
    // Must reference the source entry point, not a compiled output
    expect(devScript).toMatch(/src\/index\.ts/);
  });
});

// ─── AC1b: tsconfig.json exists ──────────────────────────────────────────────

describe("AC1b – mcp/tsconfig.json", () => {
  test("file exists", () => {
    expect(existsSync(MCP_TSCONFIG)).toBe(true);
  });

  test("is valid JSON", () => {
    const raw = readFileSync(MCP_TSCONFIG, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── AC2: src/index.ts initialises an MCP server with stdio transport ────────

describe("AC2 – mcp/src/index.ts — MCP server with stdio transport", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(MCP_INDEX, "utf-8");
  });

  test("src/index.ts exists", () => {
    expect(existsSync(MCP_INDEX)).toBe(true);
  });

  test("imports Server (or McpServer) from @modelcontextprotocol/sdk", () => {
    // Accept either the low-level Server or the high-level McpServer class
    expect(source).toMatch(/@modelcontextprotocol\/sdk/);
  });

  test("imports StdioServerTransport", () => {
    expect(source).toMatch(/StdioServerTransport/);
  });

  test("creates a Server or McpServer instance", () => {
    expect(source).toMatch(/new\s+(Mcp)?Server\s*\(/);
  });

  test("creates a StdioServerTransport instance", () => {
    expect(source).toMatch(/new\s+StdioServerTransport\s*\(/);
  });

  test("calls server.connect() with the transport", () => {
    expect(source).toMatch(/\.connect\s*\(/);
  });
});

// ─── AC3: Database connection opens ../cassini.db relative to mcp/ ───────────

describe("AC3 – mcp/src/index.ts — SQLite connection to ../cassini.db", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(MCP_INDEX, "utf-8");
  });

  test("references ../cassini.db in source", () => {
    expect(source).toMatch(/\.\.\/cassini\.db/);
  });

  test("imports Database from bun:sqlite", () => {
    expect(source).toMatch(/bun:sqlite/);
  });

  test("cassini.db is actually reachable from mcp/ at ../cassini.db", () => {
    // The db must exist at the relative path that the server will use
    const dbPath = join(MCP_DIR, "..", "cassini.db");
    expect(existsSync(dbPath)).toBe(true);
  });

  test("../cassini.db can be opened and has expected tables", () => {
    const dbPath = join(MCP_DIR, "..", "cassini.db");
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all();
    db.close();
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("planets");
    expect(tableNames).toContain("master_plan");
  });
});

// ─── AC4 & AC5: Server starts cleanly and keeps running ──────────────────────

describe("AC4+AC5 – bun run dev starts and keeps running", () => {
  test(
    "server process starts without immediately crashing (stays alive ≥ 3 s)",
    async () => {
      const proc = Bun.spawn([process.execPath, "run", "dev"], {
        cwd: MCP_DIR,
        stdout: "pipe",
        stderr: "pipe",
        // stdio transport reads from stdin; keep stdin open so it doesn't exit
        stdin: "pipe",
      });

      // Give the server 3 seconds to either crash or stay running
      let exited = false;
      let exitCode: number | null = null;

      const exitPromise = proc.exited.then((code) => {
        exited = true;
        exitCode = code;
      });

      await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);

      if (!exited) {
        // Still running after 3 s — success; clean up
        proc.kill();
        await proc.exited;
      }

      expect(exited).toBe(false); // must NOT have exited within 3 s
    },
    10_000 // generous timeout for spawn + wait
  );

  test(
    "server stderr does not contain uncaught error or fatal crash message",
    async () => {
      const proc = Bun.spawn([process.execPath, "run", "dev"], {
        cwd: MCP_DIR,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      });

      // Collect stderr for 2 s
      let stderr = "";
      const decoder = new TextDecoder();

      const collectTask = (async () => {
        for await (const chunk of proc.stderr) {
          stderr += decoder.decode(chunk);
        }
      })();

      await new Promise((resolve) => setTimeout(resolve, 2000));
      proc.kill();
      await proc.exited.catch(() => {});

      // Allow informational lines but not hard errors
      const fatalPatterns = [
        /error:/i,
        /TypeError/,
        /ReferenceError/,
        /Cannot find module/,
        /ENOENT/,
        /SyntaxError/,
      ];

      for (const pattern of fatalPatterns) {
        expect(stderr).not.toMatch(pattern);
      }
    },
    10_000
  );
});
