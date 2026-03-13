/**
 * cli/src/index.ts — Cassini CLI entry point
 *
 * Usage:
 *   bun run src/index.ts <question> [--llm anthropic|openai] [--pretty] [--help]
 */

import { openDb } from "../../shared/db.ts";

// ── Types ──────────────────────────────────────────────────────────────────────

type LLMProvider = "anthropic" | "openai";

const VALID_LLM_PROVIDERS: LLMProvider[] = ["anthropic", "openai"];

/** Represents the parsed intent of a user question, ready for LLM routing. */
export interface QueryIntent {
  question: string;
  llm: LLMProvider;
  queryType: string;
  filters: Record<string, string>;
}

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
  let llm: LLMProvider = "anthropic";
  let help = false;
  let error: string | null = null;

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
        llm = val as LLMProvider;
      }
    } else if (!arg.startsWith("--")) {
      // First bare positional argument is the question
      if (question === null) {
        question = arg;
      }
    }
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

Examples:
  bun run src/index.ts "How many Enceladus flybys did Cassini perform?"
  bun run src/index.ts "Which team made the most observations?" --llm openai --pretty`
  );
}

// ── LLM routing stub ──────────────────────────────────────────────────────────

/**
 * Placeholder for the real LLM routing step.
 * Returns a hard-coded QueryIntent so the scaffold is runnable end-to-end.
 */
function routeToLLM(question: string, llm: LLMProvider): QueryIntent {
  return {
    question,
    llm,
    queryType: "general",
    filters: {},
  };
}

// ── Output formatting ─────────────────────────────────────────────────────────

function formatOutput(intent: QueryIntent, pretty: boolean): string {
  const stubAnswer = "[stub] Real answer would appear here once LLM routing is wired.";

  if (pretty) {
    const divider = "─".repeat(50);
    return [
      `┌${divider}`,
      `│  Question : ${intent.question}`,
      `│  Provider : ${intent.llm}`,
      `│  Type     : ${intent.queryType}`,
      `├${divider}`,
      `│  ${stubAnswer}`,
      `└${divider}`,
    ].join("\n");
  }

  return JSON.stringify(
    {
      question: intent.question,
      llm: intent.llm,
      queryType: intent.queryType,
      filters: intent.filters,
      answer: stubAnswer,
    },
    null,
    2
  );
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

  // Verify DB connection is available before proceeding
  const db = openDb();
  db.close();

  const intent = routeToLLM(parsed.question, parsed.llm);
  console.log(formatOutput(intent, parsed.pretty));
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
