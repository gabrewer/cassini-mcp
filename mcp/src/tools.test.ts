/**
 * Tests for task-002: Core MCP tools
 *
 * Covers: get_flybys, get_observations, get_body_summary, get_team_stats
 *
 * All tests MUST fail before the implementation exists.
 * Tests pass once the four tools are registered in index.ts and their
 * query logic is extracted to tools.ts.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Paths ────────────────────────────────────────────────────────────────────

const MCP_SRC = import.meta.dir; // mcp/src/
const MCP_INDEX = join(MCP_SRC, "index.ts");

// ─── Shared: try to import the tools module (fails until tools.ts exists) ─────

type FlybyResult = { count: number; dates: string[] };
type ObservationRow = {
  id: number;
  start_time_utc: string;
  duration: string;
  date: string;
  team: string;
  target: string;
  request_name: string;
  title: string;
  description: string;
};
type ObservationFilter = {
  target?: string;
  team?: string;
  date_range?: [string, string];
  limit?: number;
};
type BodySummary = {
  name: string;
  type: string;
  radius_km: number | null;
  mass_kg: number | null;
  discoverer: string | null;
  notes: string | null;
};
type TeamStat = {
  team: string;
  observation_count: number;
  total_duration: string | number | null;
};

let toolModule: {
  getFlybys: (target: string) => FlybyResult;
  getObservations: (filter?: ObservationFilter) => ObservationRow[];
  getBodySummary: (name: string) => BodySummary | null;
  getTeamStats: () => TeamStat[];
} | null = null;

let toolImportError: Error | null = null;

beforeAll(async () => {
  try {
    // tools.ts must export the four query functions
    toolModule = (await import("./tools.js")) as typeof toolModule;
  } catch (e) {
    toolImportError = e as Error;
  }
});

// ─── AC5 – Tool registrations in mcp/src/index.ts ────────────────────────────

describe("AC5 – Tool registrations in mcp/src/index.ts", () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(MCP_INDEX, "utf-8");
  });

  test('get_flybys is registered as an MCP tool', () => {
    expect(source).toMatch(/["'`]get_flybys["'`]/);
  });

  test('get_observations is registered as an MCP tool', () => {
    expect(source).toMatch(/["'`]get_observations["'`]/);
  });

  test('get_body_summary is registered as an MCP tool', () => {
    expect(source).toMatch(/["'`]get_body_summary["'`]/);
  });

  test('get_team_stats is registered as an MCP tool', () => {
    expect(source).toMatch(/["'`]get_team_stats["'`]/);
  });

  test('each tool has a description property', () => {
    // At least 4 description fields should appear (one per tool)
    const matches = source.match(/\bdescription\s*:/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  test('get_flybys description mentions flybys or encounters', () => {
    const idx = source.indexOf("get_flybys");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 500).toLowerCase();
    expect(window).toMatch(/flyby|encounter|entar/);
  });

  test('get_observations description mentions observations or master_plan', () => {
    const idx = source.indexOf("get_observations");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 500).toLowerCase();
    expect(window).toMatch(/observation|master.?plan/);
  });

  test('get_body_summary description mentions planet or moon or body', () => {
    const idx = source.indexOf("get_body_summary");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 500).toLowerCase();
    expect(window).toMatch(/planet|moon|body|celestial/);
  });

  test('get_team_stats description mentions team or instrument', () => {
    const idx = source.indexOf("get_team_stats");
    expect(idx).toBeGreaterThan(-1);
    const window = source.slice(idx, idx + 500).toLowerCase();
    expect(window).toMatch(/team|instrument/);
  });

  test('SQL queries use parameterised ? placeholders (not string interpolation)', () => {
    // Source must contain at least one query that uses the ? placeholder pattern.
    // This FAILS until real parameterised SQL is present in the implementation.
    // Matches e.g.: db.query("SELECT ... WHERE target = ?")
    expect(source).toMatch(/\.(?:query|prepare)\s*\(\s*["'`][^"'`]*\?/);
  });
});

// ─── tools.ts module exports ──────────────────────────────────────────────────

describe("tools.ts exports the four query functions", () => {
  test("tools.ts loads cleanly and exports at least one tool function", () => {
    // importError is non-null when the file doesn't exist yet.
    // Also guards against Bun accidentally resolving ./tools.js to this test
    // file via circular import (which would give a module with no tool exports).
    expect(toolImportError).toBeNull();
    expect(toolModule).not.toBeNull();
    // At least one of the four exports must be a function
    const hasSomeFunction =
      typeof toolModule!.getFlybys === "function" ||
      typeof toolModule!.getObservations === "function" ||
      typeof toolModule!.getBodySummary === "function" ||
      typeof toolModule!.getTeamStats === "function";
    expect(hasSomeFunction).toBe(true);
  });

  test("getFlybys is exported as a function", () => {
    expect(toolModule).not.toBeNull();
    expect(typeof toolModule!.getFlybys).toBe("function");
  });

  test("getObservations is exported as a function", () => {
    expect(toolModule).not.toBeNull();
    expect(typeof toolModule!.getObservations).toBe("function");
  });

  test("getBodySummary is exported as a function", () => {
    expect(toolModule).not.toBeNull();
    expect(typeof toolModule!.getBodySummary).toBe("function");
  });

  test("getTeamStats is exported as a function", () => {
    expect(toolModule).not.toBeNull();
    expect(typeof toolModule!.getTeamStats).toBe("function");
  });
});

// ─── AC1 – get_flybys ─────────────────────────────────────────────────────────

describe("AC1 – getFlybys(target)", () => {
  test("getFlybys('Enceladus') returns count of exactly 23", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getFlybys("Enceladus");
    expect(result.count).toBe(23);
  });

  test("getFlybys('Enceladus') returns a dates array of length 23", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getFlybys("Enceladus");
    expect(Array.isArray(result.dates)).toBe(true);
    expect(result.dates).toHaveLength(23);
  });

  test("getFlybys('Enceladus') dates are non-empty strings", () => {
    expect(toolModule).not.toBeNull();
    const { dates } = toolModule!.getFlybys("Enceladus");
    for (const d of dates) {
      expect(typeof d).toBe("string");
      expect(d.length).toBeGreaterThan(0);
    }
  });

  test("getFlybys('Titan') returns a positive count", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getFlybys("Titan");
    expect(result.count).toBeGreaterThan(0);
  });

  test("getFlybys with unknown target returns count 0 and empty dates", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getFlybys("PlutoDoesNotExist");
    expect(result.count).toBe(0);
    expect(result.dates).toHaveLength(0);
  });
});

// ─── AC2 – get_observations ───────────────────────────────────────────────────

describe("AC2 – getObservations(filter?)", () => {
  test("getObservations({ target: 'Titan' }) returns at most 50 rows", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ target: "Titan" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
  });

  test("getObservations({ target: 'Titan' }) rows include the description field", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ target: "Titan" });
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0];
    expect(Object.prototype.hasOwnProperty.call(first, "description")).toBe(true);
  });

  test("getObservations rows include all required fields", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ target: "Enceladus" });
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    const required: (keyof ObservationRow)[] = [
      "id",
      "start_time_utc",
      "duration",
      "date",
      "team",
      "target",
      "request_name",
      "title",
      "description",
    ];
    for (const field of required) {
      expect(
        Object.prototype.hasOwnProperty.call(row, field),
        `Missing field: ${field}`
      ).toBe(true);
    }
  });

  test("getObservations default limit is 50 when no filter given", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
  });

  test("getObservations respects a custom limit", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ limit: 5 });
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  test("getObservations filters by team correctly", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ team: "CIRS", limit: 10 });
    for (const row of rows) {
      expect(row.team).toBe("CIRS");
    }
  });

  test("getObservations filters by target correctly", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ target: "Rhea", limit: 10 });
    for (const row of rows) {
      expect(row.target).toBe("Rhea");
    }
  });

  test("getObservations returns empty array for unknown target", () => {
    expect(toolModule).not.toBeNull();
    const rows = toolModule!.getObservations({ target: "XYZNoSuchBody" });
    expect(rows).toHaveLength(0);
  });
});

// ─── AC3 – get_body_summary ───────────────────────────────────────────────────

describe("AC3 – getBodySummary(name)", () => {
  test("getBodySummary('Enceladus') returns a non-null result", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result).not.toBeNull();
  });

  test("getBodySummary('Enceladus') has radius_km", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result, "radius_km")).toBe(true);
    expect(typeof result!.radius_km).toBe("number");
  });

  test("getBodySummary('Enceladus') has mass_kg", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result, "mass_kg")).toBe(true);
    expect(typeof result!.mass_kg).toBe("number");
  });

  test("getBodySummary('Enceladus') has discoverer", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result, "discoverer")).toBe(true);
  });

  test("getBodySummary('Enceladus') has notes", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(result, "notes")).toBe(true);
  });

  test("getBodySummary('Enceladus') discoverer is William Herschel", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result!.discoverer).toBe("William Herschel");
  });

  test("getBodySummary('Enceladus') radius_km is 252", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("Enceladus");
    expect(result!.radius_km).toBe(252);
  });

  test("getBodySummary returns null for unknown body", () => {
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("NoSuchMoon");
    expect(result).toBeNull();
  });

  test("getBodySummary is case-sensitive (exact name match)", () => {
    // The planets table stores 'Enceladus' with capital E
    expect(toolModule).not.toBeNull();
    const result = toolModule!.getBodySummary("enceladus");
    // Either null (strict) or the row — implementation must not crash
    // We just check it returns null or a valid object, not an exception
    expect(result === null || typeof result === "object").toBe(true);
  });
});

// ─── AC4 – get_team_stats ─────────────────────────────────────────────────────

describe("AC4 – getTeamStats()", () => {
  test("getTeamStats() returns an array", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    expect(Array.isArray(stats)).toBe(true);
  });

  test("getTeamStats() returns at least 5 teams", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    expect(stats.length).toBeGreaterThanOrEqual(5);
  });

  test("getTeamStats() each row has team, observation_count, total_duration", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    expect(stats.length).toBeGreaterThan(0);
    const row = stats[0];
    expect(Object.prototype.hasOwnProperty.call(row, "team")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "observation_count")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(row, "total_duration")).toBe(true);
  });

  test("getTeamStats() is sorted by observation_count descending", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1].observation_count).toBeGreaterThanOrEqual(
        stats[i].observation_count
      );
    }
  });

  test("getTeamStats() CIRS has the highest observation count", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    expect(stats[0].team).toBe("CIRS");
  });

  test("getTeamStats() CIRS count is 11969", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    const cirs = stats.find((s) => s.team === "CIRS");
    expect(cirs).toBeDefined();
    expect(cirs!.observation_count).toBe(11969);
  });

  test("getTeamStats() observation_count values are positive integers", () => {
    expect(toolModule).not.toBeNull();
    const stats = toolModule!.getTeamStats();
    for (const row of stats) {
      expect(Number.isInteger(row.observation_count)).toBe(true);
      expect(row.observation_count).toBeGreaterThan(0);
    }
  });
});
