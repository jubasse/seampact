// The guards of a framework's own OpenAPI document that carries seampact's operations: the document must be
// OpenAPI 3.1, and a component two apis (or the app) declare is written once when equal and refused when not.
// Copied into the generated tree as is.
export const REQUIRED_OPENAPI_PREFIX = "3.1.";

export type ComponentSections = Record<string, Record<string, unknown> | undefined>;

/** Throws unless the framework's document says it is OpenAPI 3.1.x, which the seampact schemas need. */
export function assertOpenApi31(version: unknown, api: string): void {
  if (typeof version === "string" && version.startsWith(REQUIRED_OPENAPI_PREFIX)) return;

  throw new Error(
    `seampact: the OpenAPI document of the app says openapi ${JSON.stringify(version)}, and the contract of api '${api}' needs 3.1.x (its schemas use \`type: [T, "null"]\`). Set \`openapi: '3.1.0'\` in the framework's document options.`,
  );
}

/**
 * Adds the components of an api to those a document already holds. Throws when a name is held with another value,
 * naming both; an equal value is written once.
 */
export function mergeComponents(
  held: ComponentSections | undefined,
  added: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  api: string,
): ComponentSections {
  const merged: ComponentSections = held === undefined ? {} : structuredClone(held);

  for (const [section, entries] of Object.entries(added)) {
    const target = (merged[section] ??= {});

    for (const [name, value] of Object.entries(entries)) {
      if (!(name in target)) {
        target[name] = structuredClone(value);

        continue;
      }

      if (JSON.stringify(target[name]) === JSON.stringify(value)) continue;

      throw new Error(
        `seampact: the component '${section}.${name}' of api '${api}' is ${JSON.stringify(value)}, and the document already holds ${JSON.stringify(target[name])}. Give each api its own document (Nest's \`include\`, or a second Fastify instance), or make the two components equal.`,
      );
    }
  }

  return merged;
}
