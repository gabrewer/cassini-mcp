/**
 * Tests for task-002: CLI scaffolding
 *
 * Verifies acceptance criteria for the cli/ package scaffold:
 *   1. cli/package.json exists with a dev script
 *   2. --help prints usage and exits 0
 *   3. no args prints an error and exits 1
 *   4. a question arg runs without crashing (stub response)
 *   5. --pretty flag is parsed and changes output formatting
 *   6. --llm flag accepts anthropic|openai and rejects other values
 *
 * All tests MUST fail before the implementation exists.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const CLI_DIR = join(PROJECT_ROOT, "cli");
const CLI_PKG = join(CLI_DIR, "package.json");
const CLI_TSCONFIG = join(CLI_DIR, "tsconfig.json");
const CLI_INDEX = join(CLI_DIR, "src", "index.ts");

/** Spawn cli/src/index.ts with the given args and return { exitCode, stdout, stderr }. */
async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn([process.execPath, CLI_INDEX, ...args], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  const decoder = new TextDecoder();
  let stdout = "";
  let stderr = "";

  // Collect output concurrently with the process exiting
  const stdoutTask = (async () => {
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk);
    }
  })();
  const stderrTask = (async () => {
    for await (const chunk of proc.stderr) {
      stderr += decoder.decode(chunk);
    }
  })();

  const exitCode = await proc.exited;
  await Promise.all([stdoutTask, stderrTask]);

  return { exitCode, stdout, stderr };
}

// ─── AC1: cli/package.json ────────────────────────────────────────────────────

describe("AC1 – cli/package.json", () => {
  test("file exists", () => {
    expect(existsSync(CLI_PKG)).toBe(true);
  });

  test("is valid JSON", () => {
    const raw = readFileSync(CLI_PKG, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test("has a 'dev' script", () => {
    const pkg = JSON.parse(readFileSync(CLI_PKG, "utf-8"));
    expect(pkg.scripts?.dev).toBeTruthy();
  });

  test("dev script references src/index.ts", () => {
    const pkg = JSON.parse(readFileSync(CLI_PKG, "utf-8"));
    const devScript: string = pkg.scripts?.dev ?? "";
    expect(devScript).toMatch(/src\/index\.ts/);
  });
});

// ─── AC1b: cli/tsconfig.json ──────────────────────────────────────────────────

describe("AC1b – cli/tsconfig.json", () => {
  test("file exists", () => {
    expect(existsSync(CLI_TSCONFIG)).toBe(true);
  });

  test("is valid JSON", () => {
    const raw = readFileSync(CLI_TSCONFIG, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

// ─── AC1c: cli/src/index.ts exists and imports openDb ────────────────────────

describe("AC1c – cli/src/index.ts", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(CLI_INDEX, "utf-8");
  });

  test("file exists", () => {
    expect(existsSync(CLI_INDEX)).toBe(true);
  });

  test("imports openDb from shared/db", () => {
    expect(source).toMatch(/openDb/);
    expect(source).toMatch(/shared\/db/);
  });
});

// ─── AC2: --help exits 0 with usage text ─────────────────────────────────────

describe("AC2 – --help flag", () => {
  test(
    "exits with code 0",
    async () => {
      const { exitCode } = await runCli(["--help"]);
      expect(exitCode).toBe(0);
    },
    10_000
  );

  test(
    "prints usage information to stdout",
    async () => {
      const { stdout, stderr } = await runCli(["--help"]);
      const combined = stdout + stderr;
      expect(combined.toLowerCase()).toMatch(/usage/);
    },
    10_000
  );

  test(
    "mentions the --pretty flag in help text",
    async () => {
      const { stdout, stderr } = await runCli(["--help"]);
      const combined = stdout + stderr;
      expect(combined).toMatch(/--pretty/);
    },
    10_000
  );

  test(
    "mentions the --llm flag in help text",
    async () => {
      const { stdout, stderr } = await runCli(["--help"]);
      const combined = stdout + stderr;
      expect(combined).toMatch(/--llm/);
    },
    10_000
  );
});

// ─── AC3: no args exits 1 with an error message ──────────────────────────────

describe("AC3 – missing question argument", () => {
  test(
    "exits with code 1 when no arguments are given",
    async () => {
      const { exitCode, stderr } = await runCli([]);
      // Guard: if the file doesn't exist yet, Bun emits "module not found" and
      // also exits 1 — but that is NOT the implementation's own error handling.
      // This test only counts once the module resolves correctly.
      expect(stderr).not.toMatch(/module not found|Cannot find module/i);
      expect(exitCode).toBe(1);
    },
    10_000
  );

  test(
    "prints an error message when no question is supplied",
    async () => {
      const { stdout, stderr } = await runCli([]);
      const combined = stdout + stderr;
      // Must not be a runtime "file not found" error from Bun itself
      expect(combined).not.toMatch(/module not found|Cannot find module/i);
      // Must mention the problem — any of these signal an error to the user
      expect(combined.toLowerCase()).toMatch(/error|question|required|usage/);
    },
    10_000
  );
});

// ─── AC4: a question argument runs without crashing ──────────────────────────

describe("AC4 – question argument runs end-to-end", () => {
  test(
    "exits with code 0 for a simple question",
    async () => {
      const { exitCode, stderr } = await runCli(["test question"]);
      // stderr must not contain a hard crash
      expect(stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
      expect(exitCode).toBe(0);
    },
    15_000
  );

  test(
    "produces some output for a question (not a Bun module error)",
    async () => {
      const { stdout, stderr } = await runCli(["test question"]);
      const combined = stdout + stderr;
      // Must not be Bun's own "module not found" — actual CLI output required
      expect(combined).not.toMatch(/module not found|Cannot find module/i);
      expect(combined.trim().length).toBeGreaterThan(0);
    },
    15_000
  );
});

// ─── AC5: --pretty flag changes output formatting ────────────────────────────

describe("AC5 – --pretty flag", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(CLI_INDEX, "utf-8");
  });

  test("source code references the --pretty flag", () => {
    expect(source).toMatch(/pretty/);
  });

  test(
    "output with --pretty differs from output without --pretty",
    async () => {
      const [plain, pretty] = await Promise.all([
        runCli(["test question"]),
        runCli(["test question", "--pretty"]),
      ]);
      // The formatted output must be different in some observable way
      expect(plain.stdout + plain.stderr).not.toBe(
        pretty.stdout + pretty.stderr
      );
    },
    20_000
  );

  test(
    "--pretty does not cause a crash (exits 0)",
    async () => {
      const { exitCode, stderr } = await runCli(["test question", "--pretty"]);
      expect(stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
      expect(exitCode).toBe(0);
    },
    15_000
  );
});

// ─── AC6: --llm flag validation ───────────────────────────────────────────────

describe("AC6 – --llm flag", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(CLI_INDEX, "utf-8");
  });

  test("source code references the --llm flag", () => {
    expect(source).toMatch(/llm/);
  });

  test("source accepts 'anthropic' as a valid LLM value", () => {
    expect(source).toMatch(/anthropic/);
  });

  test("source accepts 'openai' as a valid LLM value", () => {
    expect(source).toMatch(/openai/);
  });

  test(
    "--llm anthropic runs without crashing",
    async () => {
      const { exitCode, stderr } = await runCli([
        "test question",
        "--llm",
        "anthropic",
      ]);
      expect(stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
      expect(exitCode).toBe(0);
    },
    15_000
  );

  test(
    "--llm openai runs without crashing",
    async () => {
      const { exitCode, stderr } = await runCli([
        "test question",
        "--llm",
        "openai",
      ]);
      expect(stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
      expect(exitCode).toBe(0);
    },
    15_000
  );

  test(
    "--llm with an invalid value exits non-zero",
    async () => {
      const { exitCode } = await runCli([
        "test question",
        "--llm",
        "invalid-llm-value",
      ]);
      expect(exitCode).not.toBe(0);
    },
    10_000
  );

  test(
    "--llm with an invalid value prints an error message",
    async () => {
      const { stdout, stderr } = await runCli([
        "test question",
        "--llm",
        "invalid-llm-value",
      ]);
      const combined = stdout + stderr;
      expect(combined.toLowerCase()).toMatch(/error|invalid|unknown|llm/);
    },
    10_000
  );
});
