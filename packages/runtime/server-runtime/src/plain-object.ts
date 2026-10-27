// Whether a value is a JSON object, with no other runtime import, so a module the package's own tests import stays
// free of the hooks package.

/** Whether a value is a JSON object (not null, not an array). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
