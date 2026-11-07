// The `x-seampact-*` extensions the emitter writes, each with the JSON Schema the package publishes under
// `schemas/extensions/<name>.schema.json`.

export const EXTENSION_PREFIX = "x-seampact-";

export const EXTENSION_NAMES = [
  "access",
  "api",
  "apis",
  "bindings",
  "budget-ms",
  "cache-control",
  "concurrency",
  "csrf",
  "degradable",
  "deprecation",
  "derived-from",
  "discriminator",
  "enum",
  "enum-fallback",
  "errors",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "filtered-by",
  "format",
  "idempotency",
  "internal",
  "maturity",
  "max-size",
  "maximum",
  "minimum",
  "multipleOf",
  "nature",
  "opaque",
  "owner",
  "paging",
  "principal-requires",
  "raw-body",
  "relays",
  "requires",
  "restricted-to",
  "scopes",
  "semantic",
  "signature",
  "source-api",
  "unknown-keys",
  "unknown-query",
  "upstream",
] as const;

export type ExtensionName = (typeof EXTENSION_NAMES)[number];

export function isExtensionName(name: string): name is ExtensionName {
  return (EXTENSION_NAMES as readonly string[]).includes(name);
}

/** The path of an extension's JSON Schema, relative to the package root. */
export function extensionSchemaPath(name: ExtensionName): string {
  return `schemas/extensions/${name}.schema.json`;
}
