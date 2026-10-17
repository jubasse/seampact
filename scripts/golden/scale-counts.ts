import type { JsonObject, LoadedApi } from "./compiler.ts";

// What the scale fixture holds, counted on the raw tree the loader produced (the IR counts are PR 2's): the volumes
// FR-18 names, and a reachability walk that finds a declaration no route reaches, which finalize would prune.

export interface ScaleCounts {
  operations: Record<string, number>;
  /** Operations in surfaces the generator does not write. */
  handWrittenOperations: number;
  schemas: number;
  examples: number;
  errorCodes: number;
  errorFamilies: number;
  identities: number;
  schemes: number;
  enums: number;
}

type Declarations = Record<string, JsonObject>;

type Catalogue = (typeof CATALOGUES)[number];

const CATALOGUES = [
  "schemas",
  "enums",
  "errors",
  "rights",
  "rules",
  "scopes",
  "schemes",
  "headers",
  "identities",
  "buckets",
  "requirements",
  "pagings",
] as const;

// Catalogues that the api's conventions reach whether or not a route names them.
const ALWAYS_REACHED_ROOTS = ["conventions"];

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(parent: JsonObject, key: string): JsonObject {
  const value = parent[key];

  return isObject(value) ? value : {};
}

function operationsInNode(node: JsonObject): number {
  let count = typeof node.method === "string" ? 1 : 0;
  const operations = node.ops;

  if (Array.isArray(operations)) count += operations.length;
  else if (isObject(operations)) count += Object.keys(operations).length;

  const children = [
    objectAt(node, "routes"),
    objectAt(objectAt(node, "collection"), "routes"),
    objectAt(objectAt(node, "member"), "routes"),
  ];

  for (const routes of children) count += operationsInRoutes(routes);

  return count;
}

function operationsInRoutes(routes: JsonObject): number {
  return Object.values(routes).reduce<number>(
    (total, node) => total + (isObject(node) ? operationsInNode(node) : 0),
    0,
  );
}

/** The operations a surface declares: each method route and each entry of an `ops` list or map, at any depth. */
export function surfaceOperationCount(surface: JsonObject): number {
  return operationsInRoutes(objectAt(surface, "routes"));
}

function exampleCount(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce<number>((total, item) => total + exampleCount(item), 0);

  if (!isObject(value)) return 0;
  let total = 0;

  for (const [key, member] of Object.entries(value)) {
    total +=
      key === "examples" && isObject(member) ? Object.keys(member).length : exampleCount(member);
  }

  return total;
}

/** The declarations of every layer of the workspace's apis, each file once. */
function declarationsOf(apis: readonly LoadedApi[]): Record<Catalogue, Declarations> {
  const seen = new Set<string>();
  const merged = emptyDeclarations();

  for (const api of apis) {
    for (const layer of api.layers) {
      if (seen.has(layer.file)) continue;
      seen.add(layer.file);

      for (const catalogue of CATALOGUES) {
        for (const [name, declaration] of Object.entries(objectAt(layer.tree, catalogue))) {
          if (isObject(declaration)) merged[catalogue][name] = declaration;
          else merged[catalogue][name] = { value: declaration };
        }
      }
    }
  }

  return merged;
}

function emptyDeclarations(): Record<Catalogue, Declarations> {
  return {
    schemas: {},
    enums: {},
    errors: {},
    rights: {},
    rules: {},
    scopes: {},
    schemes: {},
    headers: {},
    identities: {},
    buckets: {},
    requirements: {},
    pagings: {},
  };
}

function errorFamilyOf(code: string, declaration: JsonObject): string {
  return typeof declaration.family === "string" ? declaration.family : (code.split(".")[0] ?? code);
}

export function scaleCounts(
  apis: readonly LoadedApi[],
  generatedSurfaces: Record<string, string[]>,
): ScaleCounts {
  const declarations = declarationsOf(apis);
  const operations: Record<string, number> = {};
  let handWrittenOperations = 0;
  let examples = 0;

  for (const api of apis) {
    const surfaces = objectAt(api.merged, "surfaces");

    operations[api.name] = 0;
    examples += exampleCount(surfaces);

    for (const [surfaceName, surface] of Object.entries(surfaces)) {
      const count = isObject(surface) ? surfaceOperationCount(surface) : 0;

      operations[api.name] = (operations[api.name] ?? 0) + count;

      if (!generatedSurfaces[api.name]?.includes(surfaceName)) handWrittenOperations += count;
    }
  }

  return {
    operations,
    handWrittenOperations,
    schemas: Object.keys(declarations.schemas).length,
    examples,
    errorCodes: Object.keys(declarations.errors).length,
    errorFamilies: new Set(
      Object.entries(declarations.errors).map(([code, declaration]) =>
        errorFamilyOf(code, declaration),
      ),
    ).size,
    identities: Object.keys(declarations.identities).length,
    schemes: Object.keys(declarations.schemes).length,
    enums: Object.keys(declarations.enums).length,
  };
}

/** Every string value and every mapping key below a value. */
function tokensIn(value: unknown, into: Set<string>): void {
  if (typeof value === "string") into.add(value);
  else if (Array.isArray(value)) for (const item of value) tokensIn(item, into);
  else if (isObject(value)) {
    for (const [key, member] of Object.entries(value)) {
      into.add(key);
      tokensIn(member, into);
    }
  }
}

/**
 * The declarations no route reaches, as `<catalogue>.<name>`. A name is reached when it appears as a string or a
 * mapping key in a reached tree: the surfaces and the conventions to begin with, then each reached declaration.
 */
export function unreachableDeclarations(apis: readonly LoadedApi[]): string[] {
  const declarations = declarationsOf(apis);
  const owners = new Map<string, Catalogue[]>();
  const reached = new Set<string>();
  const pending = new Set<string>();

  for (const catalogue of CATALOGUES) {
    for (const name of Object.keys(declarations[catalogue])) {
      owners.set(name, [...(owners.get(name) ?? []), catalogue]);
    }
  }

  for (const api of apis) {
    tokensIn(objectAt(api.merged, "surfaces"), pending);

    for (const root of ALWAYS_REACHED_ROOTS) tokensIn(objectAt(api.merged, root), pending);
  }

  while (pending.size > 0) {
    const [token] = pending;

    if (token === undefined) break;
    pending.delete(token);

    for (const catalogue of owners.get(token) ?? []) {
      const key = `${catalogue}.${token}`;

      if (reached.has(key)) continue;
      reached.add(key);
      tokensIn(declarations[catalogue][token], pending);
    }
  }

  return CATALOGUES.flatMap((catalogue) =>
    Object.keys(declarations[catalogue]).map((name) => `${catalogue}.${name}`),
  )
    .filter((key) => !reached.has(key))
    .sort();
}

/** How many times each enum is used by a schema property or item, `enum: <Name>` or a narrowing of it. */
export function enumUseCounts(apis: readonly LoadedApi[]): Record<string, number> {
  const uses: Record<string, number> = {};
  const seen = new Set<string>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) value.forEach(visit);

    if (!isObject(value)) return;
    const used = value.enum;

    if (typeof used === "string") uses[used] = (uses[used] ?? 0) + 1;

    for (const member of Object.values(value)) visit(member);
  }

  for (const api of apis) {
    for (const layer of api.layers) {
      if (seen.has(layer.file)) continue;
      seen.add(layer.file);
      visit(objectAt(layer.tree, "schemas"));
    }
  }

  return uses;
}
