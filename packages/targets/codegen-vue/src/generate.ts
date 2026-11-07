import {
  apiIndexSource,
  FRONT_MODULE_SUFFIX,
  FRONT_RUNTIME_MODULE,
  FRONT_RUNTIME_SPECIFIER,
  FRONT_RUNTIME_TYPE_NAMES,
  fetchQueriesModuleSource,
  frontRuntimeFile,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  importSpecifier,
  planQueries,
  type QueriesImports,
  type QueryPlan,
  type Refusal,
  refuseUnsupportedClientErrorStyle,
} from "@seampact/codegen-core";
import { composablesModuleSource as fetchComposablesModuleSource } from "./fetch/composables-module.js";
import type { VueQueryOptions } from "./options.js";
import { composablesModuleSource as piniaColadaComposablesModuleSource } from "./pinia-colada/composables-module.js";
import { queriesModuleSource as piniaColadaQueriesModuleSource } from "./pinia-colada/queries-module.js";
import { composablesModuleSource as tanstackComposablesModuleSource } from "./tanstack/composables-module.js";
import { queriesModuleSource as tanstackQueriesModuleSource } from "./tanstack/queries-module.js";

export const QUERIES_ARTEFACT = "queries";
export const COMPOSABLES_ARTEFACT = "composables";
export const ITEMS_OF_ARTEFACT = "itemsOf";

export type VueArtefact =
  | typeof QUERIES_ARTEFACT
  | typeof COMPOSABLES_ARTEFACT
  | typeof ITEMS_OF_ARTEFACT;

const QUERIES_MODULE = "queries";
const COMPOSABLES_MODULE = "composables";
const INDEX_MODULE = "index";
const MODULE_EXTENSION = ".ts";
const ITEMS_OF = "itemsOf";

// Per api: the front runtime, `queries.ts`, `composables.ts` unless the artefact is off, and an index re-exporting
// them; or every refusal at once.
export function generateVueQueries(
  input: GenerateInput<VueQueryOptions, VueArtefact, "client">,
): GenerateOutcome {
  if (!input.artefacts.has(QUERIES_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links, options } = input;
  const client = links.client.descriptor;
  const refusals = [
    ...refuseUnsupportedClientErrorStyle(options.errors, client.errorStyle),
    ...refuseUnsupportedArtefacts(options, input.artefacts),
  ];

  if (refusals.length > 0) return { status: "refused", refusals };

  const planned = planQueries(ir, client, { infinite: options.infinite === "on" });

  if (planned.status === "refused") return planned;

  const clientSpecifier = (fromFile: string) =>
    importSpecifier(links.client, client.exports.Client, fromFile);
  const files = queriesAndComposablesFiles(planned.plan, options, options.keysRoot ?? ir.api.id, {
    withComposables: input.artefacts.has(COMPOSABLES_ARTEFACT),
    withItemsOf: input.artefacts.has(ITEMS_OF_ARTEFACT),
    clientSpecifier,
  });

  return { status: "generated", files: [frontRuntimeFile(), ...files], warnings: planned.warnings };
}

interface LibraryFiles {
  readonly withComposables: boolean;
  readonly withItemsOf: boolean;
  readonly clientSpecifier: (fromFile: string) => string;
}

function queriesAndComposablesFiles(
  plan: QueryPlan,
  options: VueQueryOptions,
  root: string,
  library: LibraryFiles,
): GeneratedFile[] {
  const queriesFile = `${QUERIES_MODULE}${MODULE_EXTENSION}`;
  const composablesFile = `${COMPOSABLES_MODULE}${MODULE_EXTENSION}`;
  const queriesImports = {
    client: library.clientSpecifier(queriesFile),
    runtime: FRONT_RUNTIME_SPECIFIER,
  };
  const composablesImports = {
    client: library.clientSpecifier(composablesFile),
    queries: `./${QUERIES_MODULE}${FRONT_MODULE_SUFFIX}`,
    runtime: FRONT_RUNTIME_SPECIFIER,
  };
  const sources = librarySources(plan, options, root, queriesImports, composablesImports);
  const indexed: IndexedModule[] = [
    ...(library.withComposables ? [{ module: COMPOSABLES_MODULE }] : []),
    { module: QUERIES_MODULE },
    {
      module: FRONT_RUNTIME_MODULE,
      typeNames: [...FRONT_RUNTIME_TYPE_NAMES],
      valueNames: library.withItemsOf ? [ITEMS_OF] : [],
    },
  ];

  return [
    { path: queriesFile, contents: `${sources.queries}\n` },
    ...(library.withComposables
      ? [{ path: composablesFile, contents: `${sources.composables()}\n` }]
      : []),
    { path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(indexed) },
  ];
}

interface LibrarySources {
  readonly queries: string;
  // Rendered only when the `composables` artefact is on.
  readonly composables: () => string;
}

function librarySources(
  plan: QueryPlan,
  options: VueQueryOptions,
  root: string,
  queriesImports: QueriesImports,
  composablesImports: QueriesImports & { readonly queries: string },
): LibrarySources {
  switch (options.query) {
    case "fetch":
      return {
        queries: fetchQueriesModuleSource(plan, options, queriesImports),
        composables: () => fetchComposablesModuleSource(plan, options, composablesImports),
      };
    case "pinia-colada":
      return {
        queries: piniaColadaQueriesModuleSource(plan, options, root, queriesImports),
        composables: () => piniaColadaComposablesModuleSource(plan, options, composablesImports),
      };
    case "tanstack":
      return {
        queries: tanstackQueriesModuleSource(plan, options, root, queriesImports),
        composables: () => tanstackComposablesModuleSource(plan, composablesImports),
      };
  }
}

// `itemsOf` flattens an infinite query's pages, which plain fetch has not.
function refuseUnsupportedArtefacts(
  options: VueQueryOptions,
  artefacts: ReadonlySet<VueArtefact>,
): Refusal[] {
  if (options.query !== "fetch" || !artefacts.has(ITEMS_OF_ARTEFACT)) return [];

  return [
    {
      code: "artefacts.itemsOf.unsupported",
      message:
        "The artefact 'itemsOf' flattens the pages of an infinite query, and 'query: fetch' has no infinite query.",
      fix: "Turn 'itemsOf' off, or choose 'query: tanstack' or 'query: pinia-colada'.",
      member: "",
    },
  ];
}
