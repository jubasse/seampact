/** The message of a caught value, for a diagnostic that names what failed. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
