/**
 * cli/src/drivers/openai.ts
 *
 * LlmDriver implementation using the OpenAI API (GPT).
 */

import OpenAI from "openai";
import { type LlmDriver, type QueryIntent, VALID_INTENT_TYPES, parseQueryIntent } from "./types.ts";

const MODEL = "gpt-4o-mini";

function buildSystemMessage(schemaContext: string): string {
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

export class OpenAIDriver implements LlmDriver {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async ask(question: string, schemaContext: string): Promise<QueryIntent> {
    const response = await this.client.chat.completions.create({
      model: MODEL,
      max_tokens: 256,
      messages: [
        { role: "system", content: buildSystemMessage(schemaContext) },
        { role: "user", content: question },
      ],
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("OpenAI API returned empty choices array");
    }

    const content = choice.message.content;
    if (content === null || content === undefined) {
      throw new Error("OpenAI API returned null message content");
    }

    return parseQueryIntent(content);
  }
}
