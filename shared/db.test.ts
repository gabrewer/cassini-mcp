/**
 * Tests for task-001: shared/db.ts — shared database logic
 *
 * Acceptance Criteria:
 *   AC1 – shared/db.ts exports openDb, utcDateExpr, and 6 query functions
 *   AC2 – openDb() connects to cassini.db at the project root
 *   AC3 – getFlybys('Enceladus') returns exactly 23 results
 *   AC4 – getObservations({ target: 'Titan' }) returns up to 50 rows by default
 *   AC5 – getTeamStats() returns rows sorted by observation count descending
 *   AC6 – getTargets() returns Saturn at the top
 *   AC7 – getMissionTimeline() returns one row per year;
 *          getMissionTimeline(2005) returns monthly breakdown
 *
 * NOTE: All tests MUST fail before shared/db.ts is implemented.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Database } from "bun:sqlite";
import { join, resolve } from "path";

// ── Module under test ─────────────────────────────────────────────────────────
// Import will throw "Cannot find module" until shared/db.ts is created — that
// is the intended initial failure mode.
import {
  openDb,
  utcDateExpr,
  getFlybys,
  getObservations,
  getBodySummary,
  getTeamStats,
  getMissionTimeline,
  getTargets,
} from "./db";

const PROJECT_ROOT = resolve(import.meta.dir, "..");

// ─── Shared db handle ─────────────────────────────────────────────────────────

let db: ReturnType<typeof openDb>;

beforeAll(() => {
  db = openDb();
});

afterAll(() => {
  db?.close();
});

// ─── AC1: Module exports ──────────────────────────────────────────────────────

describe("AC1 – module exports", () => {
  test("openDb is a function", () => {
    expect(typeof openDb).toBe("function");
  });

  test("utcDateExpr is a non-empty string", () => {
    expect(typeof utcDateExpr).toBe("string");
    expect(utcDateExpr.length).toBeGreaterThan(0);
  });

  test("utcDateExpr references start_time_utc (not the date column)", () => {
    expect(utcDateExpr).toContain("start_time_utc");
    // Must NOT reference the pre-formatted 'date' column
    expect(utcDateExpr).not.toMatch(/\bdate\b/);
  });

  test("getFlybys is a function", () => expect(typeof getFlybys).toBe("function"));
  test("getObservations is a function", () => expect(typeof getObservations).toBe("function"));
  test("getBodySummary is a function", () => expect(typeof getBodySummary).toBe("function"));
  test("getTeamStats is a function", () => expect(typeof getTeamStats).toBe("function"));
  test("getMissionTimeline is a function", () => expect(typeof getMissionTimeline).toBe("function"));
  test("getTargets is a function", () => expect(typeof getTargets).toBe("function"));
});

// ─── AC2: openDb() ────────────────────────────────────────────────────────────

describe("AC2 – openDb()", () => {
  test("returns a Database-like object", () => {
    expect(db).toBeDefined();
    expect(typeof db.query).toBe("function");
    expect(typeof db.close).toBe("function");
  });

  test("connects to cassini.db — master_plan table is readable", () => {
    const row = db.query<{ cnt: number }, []>(
      "SELECT COUNT(*) as cnt FROM master_plan"
    ).get();
    expect(row).not.toBeNull();
    expect(row!.cnt).toBe(61873);
  });

  test("connects to cassini.db — planets table is readable", () => {
    const row = db.query<{ cnt: number }, []>(
      "SELECT COUNT(*) as cnt FROM planets"
    ).get();
    expect(row).not.toBeNull();
    expect(row!.cnt).toBeGreaterThan(0);
  });
});

// ─── AC3: getFlybys ───────────────────────────────────────────────────────────

describe("AC3 – getFlybys()", () => {
  test("getFlybys('Enceladus') returns exactly 23 rows", async () => {
    const rows = await getFlybys("Enceladus");
    expect(rows).toHaveLength(23);
  });

  test("each flyby row has a target field equal to 'Enceladus'", async () => {
    const rows = await getFlybys("Enceladus");
    for (const row of rows) {
      expect(row.target).toBe("Enceladus");
    }
  });

  test("each flyby row has a start_time_utc field", async () => {
    const rows = await getFlybys("Enceladus");
    for (const row of rows) {
      expect(typeof row.start_time_utc).toBe("string");
      expect(row.start_time_utc.length).toBeGreaterThan(0);
    }
  });

  test("getFlybys('Titan') returns at least one result", async () => {
    const rows = await getFlybys("Titan");
    expect(rows.length).toBeGreaterThan(0);
  });

  test("getFlybys with unknown target returns empty array", async () => {
    const rows = await getFlybys("NonExistentMoon");
    expect(rows).toBeArray();
    expect(rows).toHaveLength(0);
  });
});

// ─── AC4: getObservations ─────────────────────────────────────────────────────

describe("AC4 – getObservations()", () => {
  test("getObservations({ target: 'Titan' }) returns exactly 50 rows by default", async () => {
    const rows = await getObservations({ target: "Titan" });
    expect(rows).toHaveLength(50);
  });

  test("respects an explicit limit", async () => {
    const rows = await getObservations({ target: "Titan", limit: 10 });
    expect(rows).toHaveLength(10);
  });

  test("limit: 1 returns a single row", async () => {
    const rows = await getObservations({ target: "Saturn", limit: 1 });
    expect(rows).toHaveLength(1);
  });

  test("each row has at minimum: target, team, start_time_utc", async () => {
    const rows = await getObservations({ target: "Titan", limit: 5 });
    for (const row of rows) {
      expect(typeof row.target).toBe("string");
      expect(typeof row.team).toBe("string");
      expect(typeof row.start_time_utc).toBe("string");
    }
  });

  test("all returned rows match the requested target", async () => {
    const rows = await getObservations({ target: "Rhea", limit: 20 });
    for (const row of rows) {
      expect(row.target).toBe("Rhea");
    }
  });

  test("team filter narrows results", async () => {
    const rows = await getObservations({ team: "CIRS", limit: 20 });
    for (const row of rows) {
      expect(row.team).toBe("CIRS");
    }
  });

  test("combined target + team filter works", async () => {
    const rows = await getObservations({ target: "Titan", team: "ISS", limit: 10 });
    for (const row of rows) {
      expect(row.target).toBe("Titan");
      expect(row.team).toBe("ISS");
    }
  });

  test("unknown target returns empty array (not an error)", async () => {
    const rows = await getObservations({ target: "Pluto" });
    expect(rows).toBeArray();
    expect(rows).toHaveLength(0);
  });

  test("no filters returns up to 50 rows from all targets", async () => {
    const rows = await getObservations({});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(50);
  });
});

// ─── getBodySummary ───────────────────────────────────────────────────────────

describe("getBodySummary()", () => {
  test("getBodySummary('Saturn') returns a non-null result", async () => {
    const result = await getBodySummary("Saturn");
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });

  test("Saturn result has name === 'Saturn'", async () => {
    const result = await getBodySummary("Saturn");
    expect(result!.name).toBe("Saturn");
  });

  test("Saturn result has a radius_km field", async () => {
    const result = await getBodySummary("Saturn");
    expect(typeof result!.radius_km).toBe("number");
    expect(result!.radius_km).toBeGreaterThan(0);
  });

  test("getBodySummary('Titan') returns Titan data", async () => {
    const result = await getBodySummary("Titan");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Titan");
  });

  test("getBodySummary with unknown name returns null or undefined", async () => {
    const result = await getBodySummary("Pluto");
    expect(result == null).toBe(true); // null or undefined
  });
});

// ─── AC5: getTeamStats ────────────────────────────────────────────────────────

describe("AC5 – getTeamStats()", () => {
  test("returns a non-empty array", async () => {
    const rows = await getTeamStats();
    expect(rows.length).toBeGreaterThan(0);
  });

  test("first row is CIRS (highest observation count)", async () => {
    const rows = await getTeamStats();
    expect(rows[0].team).toBe("CIRS");
  });

  test("rows are sorted by count descending", async () => {
    const rows = await getTeamStats();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].count).toBeGreaterThanOrEqual(rows[i].count);
    }
  });

  test("each row has team (string) and count (number)", async () => {
    const rows = await getTeamStats();
    for (const row of rows) {
      expect(typeof row.team).toBe("string");
      expect(typeof row.count).toBe("number");
      expect(row.count).toBeGreaterThan(0);
    }
  });

  test("CIRS count is 11969", async () => {
    const rows = await getTeamStats();
    const cirs = rows.find((r) => r.team === "CIRS");
    expect(cirs).toBeDefined();
    expect(cirs!.count).toBe(11969);
  });
});

// ─── AC6: getTargets ──────────────────────────────────────────────────────────

describe("AC6 – getTargets()", () => {
  test("returns a non-empty array", async () => {
    const rows = await getTargets();
    expect(rows.length).toBeGreaterThan(0);
  });

  test("first result is Saturn", async () => {
    const rows = await getTargets();
    expect(rows[0].target).toBe("Saturn");
  });

  test("Saturn count is 16958", async () => {
    const rows = await getTargets();
    expect(rows[0].count).toBe(16958);
  });

  test("rows are sorted by count descending", async () => {
    const rows = await getTargets();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].count).toBeGreaterThanOrEqual(rows[i].count);
    }
  });

  test("each row has target (string) and count (number)", async () => {
    const rows = await getTargets();
    for (const row of rows) {
      expect(typeof row.target).toBe("string");
      expect(typeof row.count).toBe("number");
      expect(row.count).toBeGreaterThan(0);
    }
  });

  test("Titan appears in results", async () => {
    const rows = await getTargets();
    const titan = rows.find((r) => r.target === "Titan");
    expect(titan).toBeDefined();
    expect(titan!.count).toBe(9503);
  });
});

// ─── AC7: getMissionTimeline ──────────────────────────────────────────────────

describe("AC7 – getMissionTimeline()", () => {
  test("no-arg call returns 14 rows (one per mission year 2004–2017)", async () => {
    const rows = await getMissionTimeline();
    expect(rows).toHaveLength(14);
  });

  test("each yearly row has a year field and count", async () => {
    const rows = await getMissionTimeline();
    for (const row of rows) {
      expect(typeof row.year).toBe("string");
      expect(row.year).toMatch(/^\d{4}$/);
      expect(typeof row.count).toBe("number");
      expect(row.count).toBeGreaterThan(0);
    }
  });

  test("yearly rows are ordered chronologically", async () => {
    const rows = await getMissionTimeline();
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].year > rows[i - 1].year).toBe(true);
    }
  });

  test("2004 count is 2727", async () => {
    const rows = await getMissionTimeline();
    const y2004 = rows.find((r) => r.year === "2004");
    expect(y2004).toBeDefined();
    expect(y2004!.count).toBe(2727);
  });

  test("2005 count is 6509", async () => {
    const rows = await getMissionTimeline();
    const y2005 = rows.find((r) => r.year === "2005");
    expect(y2005).toBeDefined();
    expect(y2005!.count).toBe(6509);
  });

  test("getMissionTimeline(2005) returns 12 rows (one per month)", async () => {
    const rows = await getMissionTimeline(2005);
    expect(rows).toHaveLength(12);
  });

  test("getMissionTimeline(2005) rows each have a month/period field", async () => {
    const rows = await getMissionTimeline(2005);
    for (const row of rows) {
      // Accepts either a 'month' or 'period' key
      const periodKey = "month" in row ? row.month : (row as { period: string }).period;
      expect(typeof periodKey).toBe("string");
      expect(periodKey.length).toBeGreaterThan(0);
    }
  });

  test("getMissionTimeline(2005) rows are ordered chronologically", async () => {
    const rows = await getMissionTimeline(2005);
    const keys = rows.map((r) => ("month" in r ? r.month : (r as { period: string }).period));
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] >= keys[i - 1]).toBe(true);
    }
  });

  test("getMissionTimeline(2005) total counts sum to 6509", async () => {
    const rows = await getMissionTimeline(2005);
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(6509);
  });
});
