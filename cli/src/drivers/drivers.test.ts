/**
 * cli/src/drivers/drivers.test.ts
 *
 * Tests for task-003: LlmDriver interface, QueryIntent discriminated union,
 * AnthropicDriver, and OpenAIDriver.
 *
 * These tests are written BEFORE implementation exists and must FAIL until
 * the driver files are created.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";

// ── Module mocks (hoisted by Bun before imports) ──────────────────────────────

// Capture calls so tests can inspect what was sent to the API
let lastAnthropicCallArgs: unknown = null;
let lastOpenAICallArgs: unknown = null;

// Default response — overridden per-test via mockAnthropicCreate.mockImplementation
const mockAnthropicCreate = mock(async (opts: unknown) => {
  lastAnthropicCallArgs = opts;
  return {
    content: [
      { type: "text", text: '{"type":"get_flybys","params":{"target":"Enceladus"}}' },
    ],
  };
});

const mockOpenAICreate = mock(async (opts: unknown) => {
  lastOpenAICallArgs = opts;
  return {
    choices: [
      {
        message: {
          content: '{"type":"get_flybys","params":{"target":"Enceladus"}}',
        },
      },
    ],
  };
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    constructor(_opts?: unknown) {}
    messages = { create: mockAnthropicCreate };
  },
}));

mock.module("openai", () => ({
  default: class MockOpenAI {
    constructor(_opts?: unknown) {}
    chat = { completions: { create: mockOpenAICreate } };
  },
}));

// ── Imports (will throw until the files are created) ──────────────────────────

import { AnthropicDriver } from "./anthropic.ts";
import { OpenAIDriver } from "./openai.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCHEMA_CONTEXT = "master_plan(id, start_time_utc, team, target, title)";

/** Valid JSON strings for each of the 6 intent variants. */
const VALID_INTENTS = {
  get_flybys: '{"type":"get_flybys","params":{"target":"Titan"}}',
  get_observations_all:
    '{"type":"get_observations","params":{}}',
  get_observations_filtered:
    '{"type":"get_observations","params":{"target":"Saturn","team":"CIRS","limit":10}}',
  get_body_summary: '{"type":"get_body_summary","params":{"name":"Enceladus"}}',
  get_team_stats: '{"type":"get_team_stats","params":{}}',
  get_mission_timeline_year:
    '{"type":"get_mission_timeline","params":{"year":2005}}',
  get_mission_timeline_all:
    '{"type":"get_mission_timeline","params":{}}',
  get_targets: '{"type":"get_targets","params":{}}',
};

// ── AnthropicDriver ───────────────────────────────────────────────────────────

describe("AnthropicDriver", () => {
  let driver: AnthropicDriver;

  beforeEach(() => {
    lastAnthropicCallArgs = null;
    mockAnthropicCreate.mockClear();
    driver = new AnthropicDriver("test-api-key");
  });

  test("exports a class with an ask() method", () => {
    expect(typeof AnthropicDriver).toBe("function");
    expect(typeof driver.ask).toBe("function");
  });

  // ── Happy path — all 6 intent variants ─────────────────────────────────────

  test("returns get_flybys intent with target param", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return { content: [{ type: "text", text: VALID_INTENTS.get_flybys }] };
    });
    const intent = await driver.ask("How many Titan flybys?", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_flybys");
    expect((intent as { type: string; params: { target: string } }).params.target).toBe("Titan");
  });

  test("returns get_observations intent with no params", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [{ type: "text", text: VALID_INTENTS.get_observations_all }],
      };
    });
    const intent = await driver.ask("Show me some observations", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_observations");
  });

  test("returns get_observations intent with all optional params", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [
          { type: "text", text: VALID_INTENTS.get_observations_filtered },
        ],
      };
    });
    const intent = await driver.ask(
      "Show me 10 CIRS Saturn observations",
      SCHEMA_CONTEXT
    );
    expect(intent.type).toBe("get_observations");
    const p = (intent as { type: string; params: { target?: string; team?: string; limit?: number } }).params;
    expect(p.target).toBe("Saturn");
    expect(p.team).toBe("CIRS");
    expect(p.limit).toBe(10);
  });

  test("returns get_body_summary intent with name param", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [{ type: "text", text: VALID_INTENTS.get_body_summary }],
      };
    });
    const intent = await driver.ask("Tell me about Enceladus", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_body_summary");
    expect((intent as { type: string; params: { name: string } }).params.name).toBe("Enceladus");
  });

  test("returns get_team_stats intent with empty params", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [{ type: "text", text: VALID_INTENTS.get_team_stats }],
      };
    });
    const intent = await driver.ask("Which team made the most observations?", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_team_stats");
  });

  test("returns get_mission_timeline intent with year", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [
          { type: "text", text: VALID_INTENTS.get_mission_timeline_year },
        ],
      };
    });
    const intent = await driver.ask("Monthly breakdown for 2005", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_mission_timeline");
    const p = (intent as { type: string; params: { year?: number } }).params;
    expect(p.year).toBe(2005);
  });

  test("returns get_mission_timeline intent without year", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [
          { type: "text", text: VALID_INTENTS.get_mission_timeline_all },
        ],
      };
    });
    const intent = await driver.ask("Mission overview by year", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_mission_timeline");
  });

  test("returns get_targets intent with empty params", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return {
        content: [{ type: "text", text: VALID_INTENTS.get_targets }],
      };
    });
    const intent = await driver.ask("What targets did Cassini observe?", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_targets");
  });

  // ── Error cases ─────────────────────────────────────────────────────────────

  test("throws a descriptive error when API returns invalid JSON", async () => {
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: "not valid json at all" }],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow(/parse|JSON|invalid/i);
  });

  test("throws a descriptive error when JSON has no type field", async () => {
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: '{"params":{}}' }],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow(/type|intent|invalid/i);
  });

  test("throws a descriptive error when type is not one of the 6 valid tools", async () => {
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [
        { type: "text", text: '{"type":"unknown_tool","params":{}}' },
      ],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow(/unknown_tool|invalid|type/i);
  });

  test("throws a descriptive error when API returns empty content", async () => {
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow();
  });

  // ── Schema context in prompt ────────────────────────────────────────────────

  test("includes schemaContext in the system prompt", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return { content: [{ type: "text", text: VALID_INTENTS.get_flybys }] };
    });
    await driver.ask("How many flybys?", SCHEMA_CONTEXT);
    const args = lastAnthropicCallArgs as Record<string, unknown>;
    const systemStr = JSON.stringify(args.system ?? "");
    expect(systemStr).toContain(SCHEMA_CONTEXT);
  });

  test("includes all 6 tool names in the system prompt", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return { content: [{ type: "text", text: VALID_INTENTS.get_flybys }] };
    });
    await driver.ask("How many flybys?", SCHEMA_CONTEXT);
    const args = lastAnthropicCallArgs as Record<string, unknown>;
    const systemStr = JSON.stringify(args.system ?? "");
    const toolNames = [
      "get_flybys",
      "get_observations",
      "get_body_summary",
      "get_team_stats",
      "get_mission_timeline",
      "get_targets",
    ];
    for (const name of toolNames) {
      expect(systemStr).toContain(name);
    }
  });

  test("includes the user question in the messages array", async () => {
    mockAnthropicCreate.mockImplementation(async (opts: unknown) => {
      lastAnthropicCallArgs = opts;
      return { content: [{ type: "text", text: VALID_INTENTS.get_flybys }] };
    });
    const question = "How many Enceladus flybys were there?";
    await driver.ask(question, SCHEMA_CONTEXT);
    const args = lastAnthropicCallArgs as Record<string, unknown>;
    const messagesStr = JSON.stringify(args.messages ?? "");
    expect(messagesStr).toContain(question);
  });
});

// ── OpenAIDriver ──────────────────────────────────────────────────────────────

describe("OpenAIDriver", () => {
  let driver: OpenAIDriver;

  beforeEach(() => {
    lastOpenAICallArgs = null;
    mockOpenAICreate.mockClear();
    driver = new OpenAIDriver("test-api-key");
  });

  test("exports a class with an ask() method", () => {
    expect(typeof OpenAIDriver).toBe("function");
    expect(typeof driver.ask).toBe("function");
  });

  // ── Happy path — all 6 intent variants ─────────────────────────────────────

  test("returns get_flybys intent with target param", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_flybys } }],
      };
    });
    const intent = await driver.ask("How many Titan flybys?", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_flybys");
    expect((intent as { type: string; params: { target: string } }).params.target).toBe("Titan");
  });

  test("returns get_observations intent with no params", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [
          { message: { content: VALID_INTENTS.get_observations_all } },
        ],
      };
    });
    const intent = await driver.ask("Show me some observations", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_observations");
  });

  test("returns get_observations intent with all optional params", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [
          {
            message: { content: VALID_INTENTS.get_observations_filtered },
          },
        ],
      };
    });
    const intent = await driver.ask(
      "Show me 10 CIRS Saturn observations",
      SCHEMA_CONTEXT
    );
    expect(intent.type).toBe("get_observations");
    const p = (intent as { type: string; params: { target?: string; team?: string; limit?: number } }).params;
    expect(p.target).toBe("Saturn");
    expect(p.team).toBe("CIRS");
    expect(p.limit).toBe(10);
  });

  test("returns get_body_summary intent with name param", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_body_summary } }],
      };
    });
    const intent = await driver.ask("Tell me about Enceladus", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_body_summary");
    expect((intent as { type: string; params: { name: string } }).params.name).toBe("Enceladus");
  });

  test("returns get_team_stats intent with empty params", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_team_stats } }],
      };
    });
    const intent = await driver.ask(
      "Which team made the most observations?",
      SCHEMA_CONTEXT
    );
    expect(intent.type).toBe("get_team_stats");
  });

  test("returns get_mission_timeline intent with year", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [
          {
            message: { content: VALID_INTENTS.get_mission_timeline_year },
          },
        ],
      };
    });
    const intent = await driver.ask("Monthly breakdown for 2005", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_mission_timeline");
    const p = (intent as { type: string; params: { year?: number } }).params;
    expect(p.year).toBe(2005);
  });

  test("returns get_mission_timeline intent without year", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [
          {
            message: { content: VALID_INTENTS.get_mission_timeline_all },
          },
        ],
      };
    });
    const intent = await driver.ask("Mission overview by year", SCHEMA_CONTEXT);
    expect(intent.type).toBe("get_mission_timeline");
  });

  test("returns get_targets intent with empty params", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_targets } }],
      };
    });
    const intent = await driver.ask(
      "What targets did Cassini observe?",
      SCHEMA_CONTEXT
    );
    expect(intent.type).toBe("get_targets");
  });

  // ── Error cases ─────────────────────────────────────────────────────────────

  test("throws a descriptive error when API returns invalid JSON", async () => {
    mockOpenAICreate.mockImplementation(async () => ({
      choices: [{ message: { content: "not valid json at all" } }],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow(/parse|JSON|invalid/i);
  });

  test("throws a descriptive error when JSON has no type field", async () => {
    mockOpenAICreate.mockImplementation(async () => ({
      choices: [{ message: { content: '{"params":{}}' } }],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow(/type|intent|invalid/i);
  });

  test("throws a descriptive error when type is not one of the 6 valid tools", async () => {
    mockOpenAICreate.mockImplementation(async () => ({
      choices: [
        { message: { content: '{"type":"bad_tool","params":{}}' } },
      ],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow(/bad_tool|invalid|type/i);
  });

  test("throws a descriptive error when API returns null content", async () => {
    mockOpenAICreate.mockImplementation(async () => ({
      choices: [{ message: { content: null } }],
    }));
    await expect(
      driver.ask("What is Cassini?", SCHEMA_CONTEXT)
    ).rejects.toThrow();
  });

  // ── Schema context in prompt ────────────────────────────────────────────────

  test("includes schemaContext in the system message", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_flybys } }],
      };
    });
    await driver.ask("How many flybys?", SCHEMA_CONTEXT);
    const args = lastOpenAICallArgs as Record<string, unknown>;
    const messagesStr = JSON.stringify(args.messages ?? "");
    expect(messagesStr).toContain(SCHEMA_CONTEXT);
  });

  test("includes all 6 tool names in the system message", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_flybys } }],
      };
    });
    await driver.ask("How many flybys?", SCHEMA_CONTEXT);
    const args = lastOpenAICallArgs as Record<string, unknown>;
    const messagesStr = JSON.stringify(args.messages ?? "");
    const toolNames = [
      "get_flybys",
      "get_observations",
      "get_body_summary",
      "get_team_stats",
      "get_mission_timeline",
      "get_targets",
    ];
    for (const name of toolNames) {
      expect(messagesStr).toContain(name);
    }
  });

  test("includes the user question in the messages array", async () => {
    mockOpenAICreate.mockImplementation(async (opts: unknown) => {
      lastOpenAICallArgs = opts;
      return {
        choices: [{ message: { content: VALID_INTENTS.get_flybys } }],
      };
    });
    const question = "How many Enceladus flybys were there?";
    await driver.ask(question, SCHEMA_CONTEXT);
    const args = lastOpenAICallArgs as Record<string, unknown>;
    const messagesStr = JSON.stringify(args.messages ?? "");
    expect(messagesStr).toContain(question);
  });
});

// ── QueryIntent discriminated union — runtime shape validation ────────────────

describe("QueryIntent — runtime shape", () => {
  /**
   * These tests verify that parseQueryIntent (or the equivalent internal
   * parsing logic exposed by the drivers) produces objects with the correct
   * discriminated-union shapes.  We drive it through AnthropicDriver.ask()
   * with mocked API responses so no real API call is made.
   */

  let driver: AnthropicDriver;

  beforeEach(() => {
    mockAnthropicCreate.mockClear();
    driver = new AnthropicDriver("test-api-key");
  });

  const VALID_TYPES = [
    "get_flybys",
    "get_observations",
    "get_body_summary",
    "get_team_stats",
    "get_mission_timeline",
    "get_targets",
  ] as const;

  test("returned intent always has a type field", async () => {
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: VALID_INTENTS.get_team_stats }],
    }));
    const intent = await driver.ask("q", SCHEMA_CONTEXT);
    expect("type" in intent).toBe(true);
  });

  test("returned intent always has a params field", async () => {
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: VALID_INTENTS.get_team_stats }],
    }));
    const intent = await driver.ask("q", SCHEMA_CONTEXT);
    expect("params" in intent).toBe(true);
  });

  test("intent type is always one of the 6 valid tool names", async () => {
    for (const [_key, jsonStr] of Object.entries(VALID_INTENTS)) {
      mockAnthropicCreate.mockImplementation(async () => ({
        content: [{ type: "text", text: jsonStr }],
      }));
      const intent = await driver.ask("q", SCHEMA_CONTEXT);
      expect(VALID_TYPES).toContain(intent.type as typeof VALID_TYPES[number]);
    }
  });

  test("exactly 6 valid intent types are accepted (no 7th)", async () => {
    const seventhTool = '{"type":"get_rings","params":{}}';
    mockAnthropicCreate.mockImplementation(async () => ({
      content: [{ type: "text", text: seventhTool }],
    }));
    await expect(driver.ask("q", SCHEMA_CONTEXT)).rejects.toThrow();
  });
});
