// A JSON object read from an untyped value (YAML, an imported module), before its members are checked.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
