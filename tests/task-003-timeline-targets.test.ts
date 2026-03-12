/**
 * Tests for task-003: get_mission_timeline and get_targets tools
 *
 * Acceptance Criteria:
 *  AC1 – get_mission_timeline() returns one row per year with observation count
 *  AC2 – get_mission_timeline(2005) returns monthly breakdown for 2005
 *  AC3 – get_targets() returns all distinct targets with counts sorted descending
 *  AC4 – Saturn appears at the top of get_targets() results
 *
 * Tests MUST fail before implementation exists.
 * Assumes the builder exports { getMissionTimeline, getTargets } from mcp/src/tools.ts
 */

import { describe, test, expect } from "bun:test";

// ── Lazy-load so individual tests fail rather than a module-level crash ───────

type YearRow = Record<string, unknown>;
type MonthRow = Record<string, unknown>;
type TargetRow = Record<string, unknown>;

type GetMissionTimeline = (year?: number) => Promise<YearRow[] | MonthRow[]>;
type GetTargets = () => Promise<TargetRow[]>;

let getMissionTimeline: GetMissionTimeline;
let getTargets: GetTargets;

// Attempt to load the (not-yet-existing) tools module.
// If the module is missing, stubs throw on every call so every test fails.
try {
  const mod = await import("../mcp/src/tools");
  getMissionTimeline = mod.getMissionTimeline;
  getTargets = mod.getTargets;
} catch {
  const missing =
    (name: string): GetMissionTimeline & GetTargets =>
    (..._args: unknown[]) => {
      throw new Error(
        `mcp/src/tools.ts not found – '${name}' is not implemented yet`
      );
    };
  getMissionTimeline = missing("getMissionTimeline");
  getTargets = missing("getTargets");
}

// Helper: call and return result or rethrow so individual tests show the error
async function callTimeline(year?: number) {
  return (await getMissionTimeline(year)) as Record<string, unknown>[];
}
async function callTargets() {
  return (await getTargets()) as Record<string, unknown>[];
}

// ─── AC1: get_mission_timeline() – yearly grouping ───────────────────────────

describe("AC1 – get_mission_timeline() yearly overview", () => {
  test("returns an array", async () => {
    const rows = await callTimeline();
    expect(Array.isArray(rows)).toBe(true);
  });

  test("returns exactly 14 rows (one per mission year 2004-2017)", async () => {
    const rows = await callTimeline();
    expect(rows).toHaveLength(14);
  });

  test("each row has a 'year' field", async () => {
    const rows = await callTimeline();
    for (const row of rows) {
      expect(row).toHaveProperty("year");
    }
  });

  test("each row has a 'count' field that is a positive integer", async () => {
    const rows = await callTimeline();
    for (const row of rows) {
      expect(row).toHaveProperty("count");
      expect(Number(row.count)).toBeGreaterThan(0);
      expect(Number.isInteger(Number(row.count))).toBe(true);
    }
  });

  test("covers the full mission span from 2004 to 2017", async () => {
    const rows = await callTimeline();
    const years = rows.map((r) => String(r.year));
    expect(years).toContain("2004");
    expect(years).toContain("2017");
  });

  test("2004 has 2,727 observations", async () => {
    const rows = await callTimeline();
    const row = rows.find((r) => String(r.year) === "2004");
    expect(row).toBeDefined();
    expect(Number(row!.count)).toBe(2727);
  });

  test("2005 has 6,509 observations", async () => {
    const rows = await callTimeline();
    const row = rows.find((r) => String(r.year) === "2005");
    expect(row).toBeDefined();
    expect(Number(row!.count)).toBe(6509);
  });

  test("2017 has 2,999 observations", async () => {
    const rows = await callTimeline();
    const row = rows.find((r) => String(r.year) === "2017");
    expect(row).toBeDefined();
    expect(Number(row!.count)).toBe(2999);
  });

  test("total observations across all years sum to 61,873", async () => {
    const rows = await callTimeline();
    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
    expect(total).toBe(61873);
  });
});

// ─── AC2: get_mission_timeline(2005) – monthly breakdown ─────────────────────

describe("AC2 – get_mission_timeline(2005) monthly breakdown", () => {
  test("returns an array", async () => {
    const rows = await callTimeline(2005);
    expect(Array.isArray(rows)).toBe(true);
  });

  test("returns exactly 12 rows (one per month)", async () => {
    const rows = await callTimeline(2005);
    expect(rows).toHaveLength(12);
  });

  test("each row has a 'month' field", async () => {
    const rows = await callTimeline(2005);
    for (const row of rows) {
      expect(row).toHaveProperty("month");
    }
  });

  test("each row has a 'count' field that is a positive integer", async () => {
    const rows = await callTimeline(2005);
    for (const row of rows) {
      expect(row).toHaveProperty("count");
      expect(Number(row.count)).toBeGreaterThan(0);
      expect(Number.isInteger(Number(row.count))).toBe(true);
    }
  });

  test("monthly counts sum to 6,509 (total 2005 observations)", async () => {
    const rows = await callTimeline(2005);
    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
    expect(total).toBe(6509);
  });

  test("October is the busiest month in 2005 with 718 observations", async () => {
    const rows = await callTimeline(2005);
    const maxRow = rows.reduce((max, r) =>
      Number(r.count) > Number(max.count) ? r : max
    );
    expect(Number(maxRow.count)).toBe(718);
    // Accept 'Oct', 'oct', 'October', '10', or 10 as valid representations
    const month = String(maxRow.month).toLowerCase();
    const isOctober =
      month === "oct" || month === "october" || month === "10";
    expect(isOctober).toBe(true);
  });

  test("January has 387 observations", async () => {
    const rows = await callTimeline(2005);
    const janRow = rows.find((r) => {
      const m = String(r.month).toLowerCase();
      return m === "jan" || m === "january" || m === "1" || m === "01";
    });
    expect(janRow).toBeDefined();
    expect(Number(janRow!.count)).toBe(387);
  });

  test("monthly rows do NOT have a 'year' property (different shape from yearly)", async () => {
    const rows = await callTimeline(2005);
    for (const row of rows) {
      expect(row["year"]).toBeUndefined();
    }
  });
});

// ─── AC2 edge: yearly vs monthly shapes differ ────────────────────────────────

describe("AC2 edge – no-arg returns yearly rows, year-arg returns monthly rows", () => {
  test("yearly result has 14 rows", async () => {
    const yearly = await callTimeline();
    expect(yearly.length).toBe(14);
  });

  test("monthly result for 2005 has 12 rows", async () => {
    const monthly = await callTimeline(2005);
    expect(monthly.length).toBe(12);
  });

  test("yearly rows have a 'year' key, monthly rows have a 'month' key", async () => {
    const yearly = await callTimeline();
    const monthly = await callTimeline(2005);
    expect(yearly[0]).toHaveProperty("year");
    expect(monthly[0]).toHaveProperty("month");
  });
});

// ─── AC3: get_targets() – all distinct targets sorted descending ──────────────

describe("AC3 – get_targets() distinct targets sorted descending", () => {
  test("returns an array", async () => {
    const rows = await callTargets();
    expect(Array.isArray(rows)).toBe(true);
  });

  test("returns exactly 46 distinct targets", async () => {
    const rows = await callTargets();
    expect(rows).toHaveLength(46);
  });

  test("each row has a 'target' field (string)", async () => {
    const rows = await callTargets();
    for (const row of rows) {
      expect(row).toHaveProperty("target");
      expect(typeof row.target).toBe("string");
    }
  });

  test("each row has a 'count' field that is a positive integer", async () => {
    const rows = await callTargets();
    for (const row of rows) {
      expect(row).toHaveProperty("count");
      expect(Number(row.count)).toBeGreaterThan(0);
      expect(Number.isInteger(Number(row.count))).toBe(true);
    }
  });

  test("results are sorted in descending order by count", async () => {
    const rows = await callTargets();
    for (let i = 1; i < rows.length; i++) {
      expect(Number(rows[i - 1].count)).toBeGreaterThanOrEqual(
        Number(rows[i].count)
      );
    }
  });

  test("all target names are unique (no duplicates)", async () => {
    const rows = await callTargets();
    const names = rows.map((r) => r.target);
    const unique = new Set(names);
    expect(unique.size).toBe(rows.length);
  });

  test("total count across all targets sums to 61,873", async () => {
    const rows = await callTargets();
    const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
    expect(total).toBe(61873);
  });
});

// ─── AC4: Saturn is at the top of get_targets() ──────────────────────────────

describe("AC4 – Saturn tops the get_targets() results", () => {
  test("first result is Saturn", async () => {
    const rows = await callTargets();
    expect(rows[0].target).toBe("Saturn");
  });

  test("Saturn has 16,958 observations", async () => {
    const rows = await callTargets();
    expect(Number(rows[0].count)).toBe(16958);
  });

  test("Titan is second with 9,503 observations", async () => {
    const rows = await callTargets();
    expect(rows[1].target).toBe("Titan");
    expect(Number(rows[1].count)).toBe(9503);
  });
});
