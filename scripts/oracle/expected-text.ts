// The expected files of one case, keyed by their path under `fixtures/expected/<case path>/`, and the JSON text the
// oracle writes them with.

export type ExpectedFiles = Map<string, string>;

const JSON_INDENT = 2;

export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, JSON_INDENT)}\n`;
