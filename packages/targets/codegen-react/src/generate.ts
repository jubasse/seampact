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
  type Refusal,
} from "@seampact/codegen-core";
import type { ReactQueryOptions } from "./options.js";
import { hooksModuleSource } from "./tanstack/hooks-module.js";
import { queriesModuleSource } from "./tanstack/queries-module.js";

export const QUERIES_ARTEFACT = "queries";
export const HOOKS_ARTEFACT = "hooks";
export const ITEMS_OF_ARTEFACT = "itemsOf";

export type ReactArtefact =
  | typeof QUERIES_ARTEFACT
  | typeof HOOKS_ARTEFACT
  | typeof ITEMS_OF_ARTEFACT;

const QUERIES_MODULE = "queries";
const HOOKS_MODULE = "hooks";
const INDEX_MODULE = "index";
const MODULE_EXTENSION = ".ts";
const MODULE_SUFFIX = ".js";
const OPTIONS_LOCATION = "";
const NEXT_LIBRARIES_RELEASE = "a later release of @seampact/codegen-react";

// Per api: the front runtime, `queries.ts`, `hooks.ts` unless the artefact is off, and an index re-exporting them;
// or every refusal at once.
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
  const queriesFile = `${QUERIES_MODULE}${MODULE_EXTENSION}`;
  const hooksFile = `${HOOKS_MODULE}${MODULE_EXTENSION}`;
  const clientSpecifier = (fromFile: string) =>
    importSpecifier(links.client, client.exports.Client, fromFile);
  const withHooks = input.artefacts.has(HOOKS_ARTEFACT);
  const files: GeneratedFile[] = [
    frontRuntimeFile(),
    {
      path: queriesFile,
      contents: `${queriesModuleSource(plan, options, options.keysRoot ?? ir.api.id, {
        client: clientSpecifier(queriesFile),
        runtime: `./${FRONT_RUNTIME_MODULE}${MODULE_SUFFIX}`,
      })}\n`,
    },
    ...(withHooks
      ? [
          {
            path: hooksFile,
            contents: `${hooksModuleSource(plan, options, {
              client: clientSpecifier(hooksFile),
              queries: `./${QUERIES_MODULE}${MODULE_SUFFIX}`,
            })}\n`,
          },
        ]
      : []),
    {
      path: `${INDEX_MODULE}${MODULE_EXTENSION}`,
      contents: apiIndexSource(indexedModules(withHooks, input.artefacts.has(ITEMS_OF_ARTEFACT))),
    },
  ];

  return { status: "generated", files, warnings: planned.warnings };
}

function indexedModules(withHooks: boolean, withItemsOf: boolean): IndexedModule[] {
  return [
    ...(withHooks ? [{ module: HOOKS_MODULE }] : []),
    { module: QUERIES_MODULE },
    {
      module: FRONT_RUNTIME_MODULE,
      typeNames: ["PlainHeaders", "WithPlainHeaders"],
      valueNames: withItemsOf ? ["itemsOf"] : [],
    },
  ];
}

// SWR and RTK Query come with the next release; `errors: data` needs a client that returns its errors.
function refuseUnsupportedForms(
  options: ReactQueryOptions,
  errorStyle: "result" | "throw",
): Refusal[] {
  const refusals: Refusal[] = [];

  if (options.query !== "tanstack") {
    refusals.push({
      code: "options.query.unsupported",
      message: `The query library '${options.query}' is not generated yet; this release generates 'tanstack'.`,
      fix: `Set 'query: tanstack', or update to ${NEXT_LIBRARIES_RELEASE} that generates '${options.query}'.`,
      member: `${OPTIONS_LOCATION}/query`,
    });
  }

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
