// JSON text of a generated file (a schema, the grammar snapshot). Biome's formatter skips these
// files (biome.json), so the layout is plain `JSON.stringify` with a trailing newline.
export function formatSchemaJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
