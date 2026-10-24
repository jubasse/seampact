import {
  apiIndexSource,
  FRONT_RUNTIME_MODULE,
  frontRuntimeFile,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  importSpecifier,
  planQueries,
  type QueryPlan,
  type Refusal,
} from "@seampact/codegen-core";
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
const MODULE_SUFFIX = ".js";
const OPTIONS_LOCATION = "";
const RUNTIME_SPECIFIER = `./${FRONT_RUNTIME_MODULE}${MODULE_SUFFIX}`;
const RUNTIME_TYPE_NAMES = ["PlainHeaders", "WithPlainHeaders"];
// RTK Query's error is a plain value whose types the app reads.
const RTK_RUNTIME_TYPE_NAMES = [...RUNTIME_TYPE_NAMES, "ContractFailure", "PlainRejection"];
const ITEMS_OF = "itemsOf";

// Per api: the front runtime, the library's modules and an index re-exporting them; or every refusal at once.
// TanStack Query and SWR get `queries.ts` and `hooks.ts` unless the artefact is off, RTK Query one `api.ts`.
export function generateReactQueries(
  input: GenerateInput<ReactQueryOptions, ReactArtefact, "client">,
): GenerateOutcome {
  if (!input.artefacts.has(QUERIES_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links, options } = input;
  const client = links.client.descriptor;
  const refusals = refuseUnsupportedForms(options, client.errorStyle);

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
    runtime: RUNTIME_SPECIFIER,
  };
  const hooksImports = {
    client: library.clientSpecifier(hooksFile),
    queries: `./${QUERIES_MODULE}${MODULE_SUFFIX}`,
    runtime: RUNTIME_SPECIFIER,
  };
  const queries =
    options.query === "swr"
      ? swrQueriesModuleSource(plan, options, root, queriesImports)
      : tanstackQueriesModuleSource(plan, options, root, queriesImports);
  const hooks =
    options.query === "swr"
      ? () => swrHooksModuleSource(plan, options, hooksImports)
      : () => tanstackHooksModuleSource(plan, options, hooksImports);
  const indexed: IndexedModule[] = [
    ...(library.withHooks ? [{ module: HOOKS_MODULE }] : []),
    { module: QUERIES_MODULE },
    runtimeModule(RUNTIME_TYPE_NAMES, library.withItemsOf),
  ];

  return [
    { path: queriesFile, contents: `${queries}\n` },
    ...(library.withHooks ? [{ path: hooksFile, contents: `${hooks()}\n` }] : []),
    { path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(indexed) },
  ];
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
      runtime: RUNTIME_SPECIFIER,
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

// `errors: data` needs a client that returns its errors.
function refuseUnsupportedForms(
  options: ReactQueryOptions,
  errorStyle: "result" | "throw",
): Refusal[] {
  const refusals: Refusal[] = [];

  if (errorStyle === "throw" && options.errors === "data") {
    refusals.push({
      code: "options.errors.unsupported",
      message:
        "The option 'errors: data' returns declared errors as data, but the linked client throws them (errorStyle: throw).",
      fix: "Link a client with 'errorStyle: result', or drop 'errors: data'.",
      member: `${OPTIONS_LOCATION}/errors`,
    });
  } else if (errorStyle === "throw") {
    refusals.push({
      code: "link.client.errorStyle.unsupported",
      message:
        "A client linked with 'errorStyle: throw' is not generated over yet: its per-operation error types are not in the client link.",
      fix: "Link a client with 'errorStyle: result' (the default); the queries still throw its declared errors as a ContractError.",
      member: "",
    });
  }

  return refusals;
}
