/**
 * cli/src/drivers/anthropic.ts
 *
 * LlmDriver implementation using the Anthropic API (Claude).
 */

import Anthropic from "@anthropic-ai/sdk";
import { type LlmDriver, type QueryIntent, VALID_INTENT_TYPES, parseQueryIntent } from "./types.ts";

const MODEL = "claude-3-5-haiku-20241022";

function buildSystemPrompt(schemaContext: string): string {
  return `You are a query router for the Cassini mission database.

Given a natural-language question, respond with a JSON object that identifies
which tool to call and what parameters to pass.

Database schema:
${schemaContext}

Available tools (you must use exactly one):
- get_flybys         — params: { target: string }
- get_observations   — params: { target?: string, team?: string, limit?: number }
- get_body_summary   — params: { name: string }
- get_team_stats     — params: {}
- get_mission_timeline — params: { year?: number }
- get_targets        — params: {}

Valid intent types: ${VALID_INTENT_TYPES.join(", ")}

Respond with ONLY a JSON object in this format:
{"type":"<tool_name>","params":{...}}

No prose, no markdown, no code fences — just the raw JSON object.`;
}

export class AnthropicDriver implements LlmDriver {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async ask(question: string, schemaContext: string): Promise<QueryIntent> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: buildSystemPrompt(schemaContext),
      messages: [{ role: "user", content: question }],
    });

    const block = response.content[0];
    if (!block) {
      throw new Error("Anthropic API returned empty content array");
    }
    if (block.type !== "text") {
      throw new Error(`Anthropic API returned unexpected content type: ${block.type}`);
    }

    return parseQueryIntent(block.text);
  }
}
