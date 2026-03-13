/**
 * cli/src/drivers/types.ts
 *
 * LlmDriver interface and QueryIntent discriminated union.
 * Each QueryIntent variant corresponds to one of the 6 MCP tool names.
 */

// ── QueryIntent discriminated union ──────────────────────────────────────────

export type QueryIntent =
  | { type: "get_flybys"; params: { target: string } }
  | { type: "get_observations"; params: { target?: string; team?: string; limit?: number } }
  | { type: "get_body_summary"; params: { name: string } }
  | { type: "get_team_stats"; params: Record<string, never> }
  | { type: "get_mission_timeline"; params: { year?: number } }
  | { type: "get_targets"; params: Record<string, never> };

/** The 6 valid tool names, used for runtime validation. */
export const VALID_INTENT_TYPES = [
  "get_flybys",
  "get_observations",
  "get_body_summary",
  "get_team_stats",
  "get_mission_timeline",
  "get_targets",
] as const;

export type IntentType = typeof VALID_INTENT_TYPES[number];

// ── Shared parser ─────────────────────────────────────────────────────────────

/**
 * Parse a raw JSON string from an LLM response into a typed QueryIntent.
 * Throws a descriptive error on any validation failure.
 */
export function parseQueryIntent(raw: string): QueryIntent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to JSON parse LLM response: ${raw}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Invalid LLM response — expected a JSON object, got: ${raw}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (!("type" in obj) || typeof obj.type !== "string") {
    throw new Error(`Invalid intent — missing or non-string "type" field in: ${raw}`);
  }

  if (!(VALID_INTENT_TYPES as readonly string[]).includes(obj.type)) {
    throw new Error(
      `Invalid intent type "${obj.type}" — must be one of: ${VALID_INTENT_TYPES.join(", ")}`
    );
  }

  return parsed as QueryIntent;
}

// ── LlmDriver interface ───────────────────────────────────────────────────────

export interface LlmDriver {
  /**
   * Ask the LLM to interpret a natural-language question and return a
   * typed QueryIntent describing which MCP tool to call and with what params.
   *
   * @param question     The user's natural-language question.
   * @param schemaContext A brief description of the database schema for context.
   * @throws If the LLM response cannot be parsed into a valid QueryIntent.
   */
  ask(question: string, schemaContext: string): Promise<QueryIntent>;
}
