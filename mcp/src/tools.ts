import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "..", "..", "cassini.db");

// Open a read-only connection for query functions
const db = new Database(DB_PATH, { readonly: true });

type YearRow = { year: string; count: number };
type MonthRow = { month: string; count: number };
type TargetRow = { target: string; count: number };

// ─── Task-002 types ───────────────────────────────────────────────────────────

export type FlybyResult = { count: number; dates: string[] };

export type ObservationRow = {
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

export type ObservationFilter = {
  target?: string;
  team?: string;
  date_range?: [string, string];
  limit?: number;
};

export type BodySummary = {
  name: string;
  type: string;
  radius_km: number | null;
  mass_kg: number | null;
  discoverer: string | null;
  notes: string | null;
};

export type TeamStat = {
  team: string;
  observation_count: number;
  total_duration: string | number | null;
};

/**
 * Returns observation counts grouped by year (all years), or a monthly
 * breakdown when a specific year is provided.
 */
export async function getMissionTimeline(year?: number): Promise<YearRow[] | MonthRow[]> {
  if (year === undefined) {
    // Yearly overview: extract 4-digit year from start_time_utc (format: YYYY-DDDTHH:MM:SS)
    const rows = db
      .query<YearRow, []>(
        `SELECT substr(start_time_utc, 1, 4) AS year,
                COUNT(*) AS count
         FROM master_plan
         GROUP BY year
         ORDER BY year`
      )
      .all();
    return rows;
  }

  // Monthly breakdown for the given year.
  // date column format is either D-Mon-YY or DD-Mon-YY.
  // The 3-char month abbreviation sits right after the first hyphen.
  const rows = db
    .query<MonthRow, [string]>(
      `SELECT substr(date, instr(date, '-') + 1, 3) AS month,
              COUNT(*) AS count
       FROM master_plan
       WHERE substr(start_time_utc, 1, 4) = ?
       GROUP BY month
       ORDER BY month`
    )
    .all(String(year));
  return rows;
}

/**
 * Returns all distinct target names with observation counts, sorted
 * descending by count.
 */
export async function getTargets(): Promise<TargetRow[]> {
  const rows = db
    .query<TargetRow, []>(
      `SELECT target,
              COUNT(*) AS count
       FROM master_plan
       GROUP BY target
       ORDER BY count DESC`
    )
    .all();
  return rows;
}

// ─── Task-002 query functions ─────────────────────────────────────────────────

/**
 * Returns the count and dates of targeted flyby events (request_name = 'ENTAR')
 * for the given target body.
 */
export function getFlybys(target: string): FlybyResult {
  type DateRow = { date: string };
  const rows = db
    .query<DateRow, [string]>(
      `SELECT date
       FROM master_plan
       WHERE lower(title) LIKE '%targeted%flyby%'
         AND target = ?
       ORDER BY start_time_utc`
    )
    .all(target);
  return { count: rows.length, dates: rows.map((r) => r.date) };
}

/**
 * Returns master_plan observations with optional filtering by target body,
 * instrument team, and UTC date range. Defaults to a limit of 50 rows.
 */
export function getObservations(filter: ObservationFilter = {}): ObservationRow[] {
  const { target, team, date_range, limit = 50 } = filter;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (target !== undefined) {
    conditions.push("target = ?");
    params.push(target);
  }
  if (team !== undefined) {
    conditions.push("team = ?");
    params.push(team);
  }
  if (date_range !== undefined) {
    conditions.push("start_time_utc >= ? AND start_time_utc <= ?");
    params.push(date_range[0], date_range[1]);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = db
    .query<ObservationRow, typeof params>(
      `SELECT id, start_time_utc, duration, date, team, target,
              request_name, title, description
       FROM master_plan
       ${where}
       ORDER BY start_time_utc
       LIMIT ?`
    )
    .all(...params);
  return rows;
}

/**
 * Returns physical and discovery facts for a planet or moon from the planets
 * table. Returns null if the body name is not found.
 */
export function getBodySummary(name: string): BodySummary | null {
  const row = db
    .query<BodySummary, [string]>(
      `SELECT name, type, radius_km, mass_kg, discoverer, notes
       FROM planets
       WHERE name = ?`
    )
    .get(name);
  return row ?? null;
}

/**
 * Returns observation count and total duration per instrument team, sorted
 * by observation count descending.
 */
export function getTeamStats(): TeamStat[] {
  return db
    .query<TeamStat, []>(
      `SELECT team,
              COUNT(*) AS observation_count,
              SUM(duration) AS total_duration
       FROM master_plan
       GROUP BY team
       ORDER BY observation_count DESC`
    )
    .all();
}
