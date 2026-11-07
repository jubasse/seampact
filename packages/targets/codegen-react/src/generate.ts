import {
  apiIndexSource,
  FRONT_MODULE_SUFFIX,
  FRONT_RUNTIME_MODULE,
  FRONT_RUNTIME_SPECIFIER,
  FRONT_RUNTIME_TYPE_NAMES,
  frontRuntimeFile,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  importSpecifier,
  planQueries,
  type QueryPlan,
  type Refusal,
  refuseUnsupportedClientErrorStyle,
} from "@seampact/codegen-core";
import { hooksModuleSource as fetchHooksModuleSource } from "./fetch/hooks-module.js";
import { queriesModuleSource as fetchQueriesModuleSource } from "./fetch/queries-module.js";
import type { ReactQueryOptions } from "./options.js";
import { apiModuleSource, refusePagesEndpointCollisions } from "./rtk/api-module.js";
import { hooksModuleSource as swrHooksModuleSource } from "./swr/hooks-module.js";
import { queriesModuleSource as swrQueriesModuleSource } from "./swr/queries-module.js";
import { hooksModuleSource as tanstackHooksModuleSource } from "./tanstack/hooks-module.js";
import { queriesModuleSource as tanstackQueriesModuleSource } from "./tanstack/queries-module.js";

export const QUERIES_ARTEFACT = "queries";
export const HOOKS_ARTEFACT = "hooks";
export const ITEMS_OF_ARTEFACT = "itemsOf";

export type ReactArtefact =
  | typeof QUERIES_ARTEFACT
  | typeof HOOKS_ARTEFACT
  | typeof ITEMS_OF_ARTEFACT;

const QUERIES_MODULE = "queries";
const HOOKS_MODULE = "hooks";
const RTK_API_MODULE = "api";
const INDEX_MODULE = "index";
const MODULE_EXTENSION = ".ts";
// RTK Query's error is a plain value whose types the app reads.
const RTK_RUNTIME_TYPE_NAMES = [...FRONT_RUNTIME_TYPE_NAMES, "ContractFailure", "PlainRejection"];
const ITEMS_OF = "itemsOf";

// Per api: the front runtime, the library's modules and an index re-exporting them; or every refusal at once.
// TanStack Query, SWR and plain fetch get `queries.ts` and `hooks.ts` unless the artefact is off, RTK Query one
// `api.ts`.
export function generateReactQueries(
  input: GenerateInput<ReactQueryOptions, ReactArtefact, "client">,
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

  const { plan } = planned;
  const collisions = options.query === "rtk" ? refusePagesEndpointCollisions(plan) : [];

  if (collisions.length > 0) return { status: "refused", refusals: collisions };

  const clientSpecifier = (fromFile: string) =>
    importSpecifier(links.client, client.exports.Client, fromFile);
  const library = {
    withHooks: input.artefacts.has(HOOKS_ARTEFACT),
    withItemsOf: input.artefacts.has(ITEMS_OF_ARTEFACT),
    clientSpecifier,
  };
  const files =
    options.query === "rtk"
      ? rtkFiles(plan, options, ir.api.id, library)
      : queriesAndHooksFiles(plan, options, options.keysRoot ?? ir.api.id, library);

  return { status: "generated", files: [frontRuntimeFile(), ...files], warnings: planned.warnings };
}

interface LibraryFiles {
  readonly withHooks: boolean;
  readonly withItemsOf: boolean;
  readonly clientSpecifier: (fromFile: string) => string;
}

function queriesAndHooksFiles(
  plan: QueryPlan,
  options: ReactQueryOptions,
  root: string,
  library: LibraryFiles,
): GeneratedFile[] {
  const queriesFile = `${QUERIES_MODULE}${MODULE_EXTENSION}`;
  const hooksFile = `${HOOKS_MODULE}${MODULE_EXTENSION}`;
  const queriesImports = {
    client: library.clientSpecifier(queriesFile),
    runtime: FRONT_RUNTIME_SPECIFIER,
  };
  const hooksImports = {
    client: library.clientSpecifier(hooksFile),
    queries: `./${QUERIES_MODULE}${FRONT_MODULE_SUFFIX}`,
    runtime: FRONT_RUNTIME_SPECIFIER,
  };
  const { queries, hooks } = librarySources(plan, options, root, queriesImports, hooksImports);
  const indexed: IndexedModule[] = [
    ...(library.withHooks ? [{ module: HOOKS_MODULE }] : []),
    { module: QUERIES_MODULE },
    runtimeModule(FRONT_RUNTIME_TYPE_NAMES, library.withItemsOf),
  ];

  return [
    { path: queriesFile, contents: `${queries}\n` },
    ...(library.withHooks ? [{ path: hooksFile, contents: `${hooks()}\n` }] : []),
    { path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(indexed) },
  ];
}

function librarySources(
  plan: QueryPlan,
  options: ReactQueryOptions,
  root: string,
  queriesImports: { readonly client: string; readonly runtime: string },
  hooksImports: { readonly client: string; readonly queries: string; readonly runtime: string },
): { readonly queries: string; readonly hooks: () => string } {
  if (options.query === "swr") {
    return {
      queries: swrQueriesModuleSource(plan, options, root, queriesImports),
      hooks: () => swrHooksModuleSource(plan, options, hooksImports),
    };
  }

  if (options.query === "fetch") {
    return {
      queries: fetchQueriesModuleSource(plan, options, queriesImports),
      hooks: () => fetchHooksModuleSource(plan, options, hooksImports),
    };
  }

  return {
    queries: tanstackQueriesModuleSource(plan, options, root, queriesImports),
    hooks: () => tanstackHooksModuleSource(plan, options, hooksImports),
  };
}

function rtkFiles(
  plan: QueryPlan,
  options: ReactQueryOptions,
  reducerPath: string,
  library: LibraryFiles,
): GeneratedFile[] {
  const apiFile = `${RTK_API_MODULE}${MODULE_EXTENSION}`;
  const source = apiModuleSource(
    plan,
    options,
    reducerPath,
    library.withHooks ? "hooks" : "noHooks",
    {
      client: library.clientSpecifier(apiFile),
      runtime: FRONT_RUNTIME_SPECIFIER,
    },
  );
  const indexed: IndexedModule[] = [
    { module: RTK_API_MODULE },
    runtimeModule(RTK_RUNTIME_TYPE_NAMES, library.withItemsOf),
  ];

  return [
    { path: apiFile, contents: `${source}\n` },
    { path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(indexed) },
  ];
}

function runtimeModule(typeNames: readonly string[], withItemsOf: boolean): IndexedModule {
  return {
    module: FRONT_RUNTIME_MODULE,
    typeNames: [...typeNames],
    valueNames: withItemsOf ? [ITEMS_OF] : [],
  };
}

// `itemsOf` flattens an infinite query's pages, which plain fetch has not.
function refuseUnsupportedArtefacts(
  options: ReactQueryOptions,
  artefacts: ReadonlySet<ReactArtefact>,
): Refusal[] {
  if (options.query !== "fetch" || !artefacts.has(ITEMS_OF_ARTEFACT)) return [];

  return [
    {
      code: "artefacts.itemsOf.unsupported",
      message:
        "The artefact 'itemsOf' flattens the pages of an infinite query, and 'query: fetch' has no infinite query.",
      fix: "Turn 'itemsOf' off, or choose a query library: tanstack, swr, rtk.",
      member: "",
    },
  ];
}
