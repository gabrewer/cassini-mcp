/**
 * shared/db.ts — shared database access layer for cassini.db
 *
 * Exports:
 *   openDb()           — opens cassini.db (read-only) at the project root
 *   utcDateExpr        — SQL fragment extracting the year from start_time_utc
 *   getFlybys          — flyby events for a target body
 *   getObservations    — filtered observation rows
 *   getBodySummary     — planet/moon metadata from the planets table
 *   getTeamStats       — observation counts per team, sorted descending
 *   getMissionTimeline — yearly (default) or monthly breakdown
 *   getTargets         — observation counts per target, sorted descending
 */

import { Database } from "bun:sqlite";
import { resolve } from "path";

// ── Database path ──────────────────────────────────────────────────────────────

const DB_PATH = resolve(import.meta.dir, "..", "cassini.db");

// ── Core helpers ───────────────────────────────────────────────────────────────

/**
 * Opens cassini.db in read-only mode.
 * Callers are responsible for calling db.close() when done.
 */
export function openDb(): Database {
  return new Database(DB_PATH, { readonly: true });
}

/**
 * SQL expression that extracts the 4-digit year from the start_time_utc column.
 * The column stores values in YYYY-DDDTHH:MM:SS (day-of-year) format so
 * strftime() does not work on it — we use substr() instead.
 *
 * Never references the pre-formatted `date` column.
 */
export const utcDateExpr = "substr(start_time_utc, 1, 4)";

// ── Row types ─────────────────────────────────────────────────────────────────

export interface MasterPlanRow {
  id: number;
  start_time_utc: string;
  duration: number | null;
  date: string;
  team: string;
  spass_type: string;
  target: string;
  request_name: string;
  title: string;
  description: string | null;
}

export interface PlanetRow {
  id: number;
  name: string;
  type: string;
  parent_body: string | null;
  distance_from_sun_km: number | null;
  orbital_period_days: number | null;
  radius_km: number;
  mass_kg: number | null;
  discovered_date: string | null;
  discoverer: string | null;
  notes: string | null;
}

export interface TeamStatRow {
  team: string;
  count: number;
}

export interface TargetRow {
  target: string;
  count: number;
}

export interface YearRow {
  year: string;
  count: number;
}

export interface MonthRow {
  month: string;
  count: number;
}

// ── Query functions ────────────────────────────────────────────────────────────

/**
 * Returns all flyby-event rows for a target body.
 *
 * Flyby events are identified by MAG-team observations that contain "flyby"
 * in their title — this yields exactly the canonical number of flybys
 * (e.g. 23 for Enceladus).
 */
export async function getFlybys(target: string): Promise<MasterPlanRow[]> {
  const db = openDb();
  try {
    return db
      .query<MasterPlanRow, [string]>(
        `SELECT *
         FROM   master_plan
         WHERE  target = ?
           AND  team   = 'MAG'
           AND  LOWER(title) LIKE '%flyby%'
         ORDER  BY start_time_utc`
      )
      .all(target);
  } finally {
    db.close();
  }
}

export interface ObservationsParams {
  target?: string;
  team?: string;
  limit?: number;
}

/**
 * Returns observation rows with optional target / team filters.
 * Defaults to 50 rows; respects an explicit `limit`.
 */
export async function getObservations(
  params: ObservationsParams
): Promise<MasterPlanRow[]> {
  const { target, team, limit = 50 } = params;

  // Build WHERE clause dynamically; bind all user values as parameters.
  const conditions: string[] = [];
  const args: string[] = [];

  if (target !== undefined) {
    conditions.push("target = ?");
    args.push(target);
  }
  if (team !== undefined) {
    conditions.push("team = ?");
    args.push(team);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // limit is always a programmer-supplied number — safe to interpolate.
  const safeLimit = Math.max(1, Math.floor(limit));

  const db = openDb();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stmt = db.query<MasterPlanRow, any[]>(
      `SELECT * FROM master_plan ${where} ORDER BY start_time_utc LIMIT ${safeLimit}`
    );
    return stmt.all(...args);
  } finally {
    db.close();
  }
}

/**
 * Returns metadata for a celestial body from the planets table.
 * Returns null when the body is not found.
 */
export async function getBodySummary(name: string): Promise<PlanetRow | null> {
  const db = openDb();
  try {
    return (
      db
        .query<PlanetRow, [string]>("SELECT * FROM planets WHERE name = ?")
        .get(name) ?? null
    );
  } finally {
    db.close();
  }
}

/**
 * Returns observation counts per team, sorted by count descending.
 */
export async function getTeamStats(): Promise<TeamStatRow[]> {
  const db = openDb();
  try {
    return db
      .query<TeamStatRow, []>(
        `SELECT   team, COUNT(*) AS count
         FROM     master_plan
         GROUP BY team
         ORDER BY count DESC`
      )
      .all();
  } finally {
    db.close();
  }
}

/**
 * getMissionTimeline() — one row per mission year (2004–2017), ordered
 *   chronologically.
 *
 * getMissionTimeline(year) — one row per month within that year, ordered
 *   chronologically.  Month values are YYYY-MM strings.
 *
 * All date filtering/grouping is done via start_time_utc (never the `date`
 * column).  The start_time_utc format is YYYY-DDDTHH:MM:SS so we use substr()
 * for the year and SQLite date arithmetic to convert DOY → calendar month.
 */
export async function getMissionTimeline(): Promise<YearRow[]>;
export async function getMissionTimeline(year: number): Promise<MonthRow[]>;
export async function getMissionTimeline(
  year?: number
): Promise<YearRow[] | MonthRow[]> {
  const db = openDb();
  try {
    if (year === undefined) {
      return db
        .query<YearRow, []>(
          `SELECT ${utcDateExpr}          AS year,
                  COUNT(*)               AS count
           FROM   master_plan
           GROUP  BY year
           ORDER  BY year`
        )
        .all();
    }

    // Convert YYYY-DDD → calendar month via SQLite date arithmetic.
    // date('YYYY-01-01', '+(DOY-1) days') produces a standard YYYY-MM-DD
    // date that strftime can then format as YYYY-MM.
    return db
      .query<MonthRow, [string]>(
        `SELECT strftime(
                  '%Y-%m',
                  date(
                    substr(start_time_utc, 1, 4) || '-01-01',
                    '+' || (CAST(substr(start_time_utc, 6, 3) AS INTEGER) - 1) || ' days'
                  )
                )                        AS month,
                COUNT(*)                 AS count
         FROM   master_plan
         WHERE  ${utcDateExpr} = ?
         GROUP  BY month
         ORDER  BY month`
      )
      .all(String(year));
  } finally {
    db.close();
  }
}

/**
 * Returns observation counts per target body, sorted by count descending.
 */
export async function getTargets(): Promise<TargetRow[]> {
  const db = openDb();
  try {
    return db
      .query<TargetRow, []>(
        `SELECT   target, COUNT(*) AS count
         FROM     master_plan
         GROUP BY target
         ORDER BY count DESC`
      )
      .all();
  } finally {
    db.close();
  }
}
