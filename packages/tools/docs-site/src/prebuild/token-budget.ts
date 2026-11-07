const BYTES_PER_TOKEN = 4;

/** Tokens as the budgets count them: a quarter of the bytes, rounded up. */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf8") / BYTES_PER_TOKEN);
}

/** The most tokens each kind of agent file may hold, with room for growth over today's size. */
export const TOKEN_BUDGETS = {
  llmsIndex: 3_400,
  stackFile: 6_000,
  llmsFull: 190_000,
} as const;
