// JSON text of a schema, laid out as Biome formats JSON (objects one member per line, an array on
// one line when it holds no object and fits in 100 columns), so the committed files pass
// `format:check` without a formatting step.
const LINE_WIDTH = 100;

export function formatSchemaJson(value: unknown): string {
  return `${format(value, "", 0)}\n`;
}

function isExpanded(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isExpanded);
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

// `prefix` is the width of the text before the value on its line; `suffix` that after it.
function format(value: unknown, indent: string, prefix: number, suffix = 0): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (!value.some(isExpanded)) {
      const inline = `[${value.map((v) => format(v, indent, 0)).join(", ")}]`;
      if (prefix + inline.length + suffix <= LINE_WIDTH) return inline;
    }
    const inner = `${indent}  `;
    const items = value.map(
      (v, i) => `${inner}${format(v, inner, inner.length, i < value.length - 1 ? 1 : 0)}`,
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const inner = `${indent}  `;
    const members = entries.map(([k, v], i) => {
      const key = `${inner}${JSON.stringify(k)}: `;
      return `${key}${format(v, inner, key.length, i < entries.length - 1 ? 1 : 0)}`;
    });
    return `{\n${members.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}
