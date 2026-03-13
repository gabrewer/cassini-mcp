/**
 * cli/src/index.test.ts
 *
 * Tests for task-004: Query routing and execution — wire LLM to DB
 *
 * All tests must FAIL while the stub is in place and pass once the real
 * routing is wired.  Two test strategies are used:
 *
 *   1. Subprocess tests (Bun.spawn) — test observable CLI behaviour without
 *      importing index.ts.  These work today; the assertions fail because the
 *      stub never checks for API keys or calls a real driver.
 *
 *   2. Module tests — test exported helper functions (executeQueryIntent,
 *      formatResult, handleRoutingError).  These require the implementation to
 *      (a) guard `main()` with `if (import.meta.main)` so the module can be
 *      imported safely, and (b) export the helpers.  Until both conditions are
 *      met the tests fail with "not a function".
 *
 * Acceptance criteria:
 *   AC1 – flyby question → JSON with 23 Enceladus rows
 *   AC2 – --pretty → human-readable output
 *   AC3 – missing ANTHROPIC_API_KEY → exit 1 + "ANTHROPIC_API_KEY" in stderr
 *   AC4 – missing OPENAI_API_KEY   → exit 1 + "OPENAI_API_KEY"   in stderr
 *   AC5 – CASSINI_LLM=openai selects OpenAI driver (no --llm needed)
 *   AC6 – --llm flag overrides CASSINI_LLM
 *   AC7 – unparseable LLM response → user-friendly error, no stack trace
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";

// ── Path constants ─────────────────────────────────────────────────────────────

const CLI_PATH = join(import.meta.dir, "index.ts");
const REPO_ROOT = join(import.meta.dir, "../..");

// ═══════════════════════════════════════════════════════════════════════════════
// Subprocess helper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Runs the CLI in a subprocess with a controlled environment.
 * ANTHROPIC_API_KEY, OPENAI_API_KEY, and CASSINI_LLM are stripped from the
 * inherited env so each test starts from a known baseline; pass them
 * explicitly via envOverride when needed.
 */
async function runCli(
  args: string[],
  envOverride: Record<string, string | undefined> = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      k !== "ANTHROPIC_API_KEY" &&
      k !== "OPENAI_API_KEY" &&
      k !== "CASSINI_LLM" &&
      v !== undefined
    ) {
      baseEnv[k] = v;
    }
  }

  const finalEnv: Record<string, string> = { ...baseEnv };
  for (const [k, v] of Object.entries(envOverride)) {
    if (v === undefined) {
      delete finalEnv[k];
    } else {
      finalEnv[k] = v;
    }
  }

  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: finalEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module-level helper setup
//
// The implementation MUST guard `main()` with `if (import.meta.main)` so this
// module import does not auto-execute the CLI.  Until that guard exists, the
// import will call process.exit and these tests will fail with the wrong error.
//
// We intercept process.exit BEFORE the dynamic import so the test process
// survives any premature exit attempt from the current stub.
// ═══════════════════════════════════════════════════════════════════════════════

type IndexModule = {
  executeQueryIntent?: (intent: {
    type: string;
    params: Record<string, unknown>;
  }) => Promise<unknown>;
  formatResult?: (data: unknown, pretty: boolean) => string;
  handleRoutingError?: (err: unknown, question: string) => string;
};

let indexMod: IndexModule = {};
let moduleLoadError: string | null = null;

// Override process.exit so a stub mis-import cannot terminate the test runner.
// (The stub calls process.exit before the import.meta.main guard is added.)
const _origExit = process.exit;
const _capturedExitCodes: number[] = [];
(process as any).exit = (code?: number) => {
  _capturedExitCodes.push(code ?? 0);
  // Throw so execution in main() stops at the exit site, but the test process
  // continues.  The throw will be caught by main()'s outer .catch().
  throw new Error(`__process_exit_intercepted__(${code ?? 0})`);
};

// Perform the dynamic import once for all module-level tests.
// If it succeeds but the exports are missing, the individual tests fail below.
beforeAll(async () => {
  try {
    indexMod = (await import("./index.ts")) as IndexModule;
  } catch (err) {
    // Record the failure reason so assertions can produce a useful message.
    moduleLoadError =
      err instanceof Error ? err.message : String(err);
  }
});

afterAll(() => {
  // Restore the real process.exit after all tests in this file complete.
  (process as any).exit = _origExit;
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC1 — executeQueryIntent dispatches get_flybys and returns 23 Enceladus rows
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC1 – executeQueryIntent dispatches to the database layer", () => {
  test("executeQueryIntent is exported from the module", () => {
    // Will fail until the implementation exports it AND guards main() with
    // import.meta.main (otherwise moduleLoadError is set).
    if (moduleLoadError) {
      throw new Error(
        `index.ts could not be imported as a module (main() must be ` +
          `guarded with \`if (import.meta.main)\`). Load error: ${moduleLoadError}`
      );
    }
    expect(typeof indexMod.executeQueryIntent).toBe("function");
  });

  test("get_flybys → Enceladus → exactly 23 rows", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const rows = (await indexMod.executeQueryIntent!({
      type: "get_flybys",
      params: { target: "Enceladus" },
    })) as unknown[];

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(23);
  });

  test("every flyby row has target === 'Enceladus'", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const rows = (await indexMod.executeQueryIntent!({
      type: "get_flybys",
      params: { target: "Enceladus" },
    })) as Array<Record<string, unknown>>;

    for (const row of rows) {
      expect(row.target).toBe("Enceladus");
    }
  });

  test("get_team_stats → non-empty array", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const rows = (await indexMod.executeQueryIntent!({
      type: "get_team_stats",
      params: {},
    })) as unknown[];

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("get_targets → non-empty array", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const rows = (await indexMod.executeQueryIntent!({
      type: "get_targets",
      params: {},
    })) as unknown[];

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("get_mission_timeline → 14 yearly rows (2004–2017)", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const rows = (await indexMod.executeQueryIntent!({
      type: "get_mission_timeline",
      params: {},
    })) as unknown[];

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(14);
  });

  test("get_body_summary → object (not null, not array) for Enceladus", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const result = await indexMod.executeQueryIntent!({
      type: "get_body_summary",
      params: { name: "Enceladus" },
    });

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    expect(typeof result).toBe("object");
  });

  test("get_observations with limit:5 → exactly 5 rows", async () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.executeQueryIntent).toBe("function");

    const rows = (await indexMod.executeQueryIntent!({
      type: "get_observations",
      params: { target: "Titan", limit: 5 },
    })) as unknown[];

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC2 — formatResult: pretty vs JSON output
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC2 – formatResult produces correct output modes", () => {
  test("formatResult is exported from the module", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.formatResult).toBe("function");
  });

  test("pretty=false returns valid JSON equal to the original data", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.formatResult).toBe("function");

    const data = [{ target: "Enceladus", count: 23 }];
    const output = indexMod.formatResult!(data, false);

    expect(() => JSON.parse(output)).not.toThrow();
    expect(JSON.parse(output)).toEqual(data);
  });

  test("pretty=true output contains the actual data values (not stub placeholder)", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.formatResult).toBe("function");

    const data = [
      { team: "CIRS", count: 11969 },
      { team: "VIMS", count: 7234 },
    ];
    const output = indexMod.formatResult!(data, true);

    // The stub returns "[stub] Real answer would appear here..." and does NOT
    // contain the real values — this forces the real implementation.
    expect(output).toContain("CIRS");
  });

  test("pretty=false output does not contain stub placeholder text", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.formatResult).toBe("function");

    const data = [{ target: "Saturn", count: 100 }];
    const output = indexMod.formatResult!(data, false);

    expect(output).not.toContain("[stub]");
    expect(output).not.toContain("Real answer would appear here");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC3 — Missing ANTHROPIC_API_KEY → exit 1 + message naming the variable
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC3 – missing ANTHROPIC_API_KEY error handling", () => {
  test("exits 1 when ANTHROPIC_API_KEY is absent with --llm anthropic", async () => {
    const { exitCode } = await runCli(
      ["How many Enceladus flybys?", "--llm", "anthropic"],
      { ANTHROPIC_API_KEY: undefined }
    );
    expect(exitCode).toBe(1);
  }, 15_000);

  test("stderr mentions ANTHROPIC_API_KEY", async () => {
    const { stderr } = await runCli(
      ["How many Enceladus flybys?", "--llm", "anthropic"],
      { ANTHROPIC_API_KEY: undefined }
    );
    expect(stderr).toContain("ANTHROPIC_API_KEY");
  }, 15_000);

  test("no stack trace lines in stderr (graceful error, not unhandled throw)", async () => {
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?", "--llm", "anthropic"],
      { ANTHROPIC_API_KEY: undefined }
    );
    // Precondition: an error must have been emitted (test is only meaningful
    // when there IS output to inspect — a stub that exits 0 with no stderr
    // would not satisfy this).
    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
    // Stack trace lines look like "    at Object.<anonymous> (file:line)"
    expect(stderr).not.toMatch(/^\s+at\s+\S/m);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC4 — Missing OPENAI_API_KEY → exit 1 + message naming the variable
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC4 – missing OPENAI_API_KEY error handling", () => {
  test("exits 1 when OPENAI_API_KEY is absent with --llm openai", async () => {
    const { exitCode } = await runCli(
      ["How many Enceladus flybys?", "--llm", "openai"],
      { OPENAI_API_KEY: undefined }
    );
    expect(exitCode).toBe(1);
  }, 15_000);

  test("stderr mentions OPENAI_API_KEY", async () => {
    const { stderr } = await runCli(
      ["How many Enceladus flybys?", "--llm", "openai"],
      { OPENAI_API_KEY: undefined }
    );
    expect(stderr).toContain("OPENAI_API_KEY");
  }, 15_000);

  test("no stack trace lines in stderr", async () => {
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?", "--llm", "openai"],
      { OPENAI_API_KEY: undefined }
    );
    // Precondition: must have errored with actual output
    expect(exitCode).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).not.toMatch(/^\s+at\s+\S/m);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC5 — CASSINI_LLM env var selects the provider (no --llm flag)
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC5 – CASSINI_LLM env var selects the LLM provider", () => {
  test("CASSINI_LLM=openai → OPENAI_API_KEY error (OpenAI driver was selected)", async () => {
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?"],
      { CASSINI_LLM: "openai", OPENAI_API_KEY: undefined }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("OPENAI_API_KEY");
  }, 15_000);

  test("CASSINI_LLM=openai does NOT trigger an ANTHROPIC_API_KEY error", async () => {
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?"],
      { CASSINI_LLM: "openai", OPENAI_API_KEY: undefined }
    );
    // Must have produced an error (OpenAI key error) — not silently succeeded
    expect(exitCode).toBe(1);
    // That error must mention OpenAI, not Anthropic
    expect(stderr).toContain("OPENAI_API_KEY");
    expect(stderr).not.toContain("ANTHROPIC_API_KEY");
  }, 15_000);

  test("default (no CASSINI_LLM, no --llm) → ANTHROPIC_API_KEY error", async () => {
    // Proves anthropic is the built-in default
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?"],
      { ANTHROPIC_API_KEY: undefined, CASSINI_LLM: undefined }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("ANTHROPIC_API_KEY");
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC6 — --llm flag overrides CASSINI_LLM
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC6 – --llm flag overrides CASSINI_LLM env var", () => {
  test("--llm openai beats CASSINI_LLM=anthropic → OPENAI_API_KEY error", async () => {
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?", "--llm", "openai"],
      {
        CASSINI_LLM: "anthropic",
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("OPENAI_API_KEY");
    expect(stderr).not.toContain("ANTHROPIC_API_KEY");
  }, 15_000);

  test("--llm anthropic beats CASSINI_LLM=openai → ANTHROPIC_API_KEY error", async () => {
    const { stderr, exitCode } = await runCli(
      ["How many Enceladus flybys?", "--llm", "anthropic"],
      {
        CASSINI_LLM: "openai",
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
      }
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("ANTHROPIC_API_KEY");
    expect(stderr).not.toContain("OPENAI_API_KEY");
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC7 — Unparseable / unknown LLM response → user-friendly error, no stack trace
// ═══════════════════════════════════════════════════════════════════════════════

describe("AC7 – handleRoutingError produces a user-friendly message", () => {
  test("handleRoutingError is exported from the module", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.handleRoutingError).toBe("function");
  });

  test("returns a non-empty string for a parse failure error", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.handleRoutingError).toBe("function");

    const msg = indexMod.handleRoutingError!(
      new Error('Failed to JSON parse LLM response: {"badkey": true}'),
      "How many Enceladus flybys?"
    );

    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(0);
  });

  test("echoes the original question back to the user", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.handleRoutingError).toBe("function");

    const question = "Tell me about the moons of Saturn";
    const msg = indexMod.handleRoutingError!(new Error("unknown intent"), question);

    expect(msg).toContain(question);
  });

  test("output does not contain raw stack trace lines", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.handleRoutingError).toBe("function");

    const err = new Error('Invalid intent type "explode" — must be one of: …');
    err.stack = `Error: Invalid intent type\n    at parseQueryIntent (cli/src/drivers/types.ts:55:5)\n    at AnthropicDriver.ask (cli/src/drivers/anthropic.ts:60:12)`;

    const msg = indexMod.handleRoutingError!(err, "some question");

    expect(msg).not.toMatch(/^\s+at\s+\S/m);
  });

  test("message contains a human-readable error indicator", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.handleRoutingError).toBe("function");

    const err = new Error("LLM returned garbage");
    const msg = indexMod.handleRoutingError!(err, "How many flybys?");

    // Should clearly indicate failure without raw internals
    expect(msg.toLowerCase()).toMatch(/error|could not|sorry|unable|understand|failed/);
  });

  test("DB error does not surface internal file paths or line numbers", () => {
    if (moduleLoadError) throw new Error(`Module load failed: ${moduleLoadError}`);
    expect(typeof indexMod.handleRoutingError).toBe("function");

    const dbErr = new Error("no such table: master_plan");
    dbErr.stack = `Error: no such table: master_plan\n    at Database.query (/path/to/bun:sqlite:native)\n    at getFlybys (shared/db.ts:102:10)`;

    const msg = indexMod.handleRoutingError!(dbErr, "How many flybys?");

    // Must not expose stack trace to the end user
    expect(msg).not.toMatch(/^\s+at\s+\S/m);
    expect(msg).not.toContain("shared/db.ts");
  });
});
