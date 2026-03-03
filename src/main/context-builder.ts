/**
 * Context Builder — slot-based prompt construction.
 *
 * Each slot gets responses it hasn't seen yet (everything after its last response).
 * No round boundaries, just a flat chronological list.
 */

import type { SlotId, RoundResponse } from "./types";

const MAX_PROMPT_LENGTH = 2000;
const RESPONSE_LIMIT = 500;

function truncate(text: string, maxLen: number): string {
  const clean = text.replace(/\n+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "…";
}

function enforceMaxLength(prompt: string, basePrompt: string): string {
  if (prompt.length <= MAX_PROMPT_LENGTH) return prompt;
  return basePrompt;
}

/**
 * Get responses this slot hasn't seen yet.
 * = everything after this slot's last response in the flat list.
 * Optionally sorted by debate slot order (not chronological).
 */
export function getUnseenResponses(
  allResponses: RoundResponse[],
  slotId: SlotId,
  slotOrder?: SlotId[]
): RoundResponse[] {
  let lastIdx = -1;
  for (let i = allResponses.length - 1; i >= 0; i--) {
    if (allResponses[i].slotId === slotId) {
      lastIdx = i;
      break;
    }
  }
  const unseen = allResponses.slice(lastIdx + 1);

  // Sort by debate slot order (GPT → Gemini → Claude → User)
  if (slotOrder && slotOrder.length > 0) {
    const orderMap = new Map(slotOrder.map((id, i) => [id, i]));
    unseen.sort((a, b) => (orderMap.get(a.slotId) ?? 99) - (orderMap.get(b.slotId) ?? 99));
  }

  return unseen;
}

/**
 * Build prompt: [instruction] → [base prompt] → [unseen responses]
 *
 * Order rationale:
 *   1. Instruction (role/persona) — AI understands its role first
 *   2. Base prompt (task/question) — AI understands what to do
 *   3. Previous responses — AI sees conversation context last
 */
export function buildPrompt(
  basePrompt: string,
  unseen: RoundResponse[],
  instruction?: string
): string {
  const parts: string[] = [];

  // 1. Role/persona instruction
  if (instruction) parts.push(instruction);

  // 2. Base prompt (task/question)
  parts.push(basePrompt);

  // 3. Previous responses (conversation context)
  if (unseen.length > 0) {
    const responses = unseen
      .map(r => `[${r.label.toUpperCase()}] ${truncate(r.content, RESPONSE_LIMIT)}`)
      .join("\n");
    parts.push(responses);
  }

  const full = parts.join("\n\n");
  return enforceMaxLength(full, basePrompt);
}

/**
 * Build a minimal retry prompt — strip context, keep only base prompt.
 */
export function buildMinimalRetryPrompt(fullPrompt: string): string {
  const idx = fullPrompt.lastIndexOf("\n\n");
  if (idx > 0 && idx < fullPrompt.length - 10) {
    return fullPrompt.slice(idx + 2);
  }
  return truncate(fullPrompt, 500);
}
