// A JSON object of an IR or draft value read without its type: neither null nor an array.
export const finalizeIsRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
