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
  type QueryPlan,
  type Refusal,
  refuseUnsupportedClientErrorStyle,
} from "@seampact/codegen-core";
import {
  HTTP_CLIENT_FETCH_MODULE,
  HTTP_CLIENT_FETCH_SOURCE,
} from "./fetch/http-client-fetch-module.js";
import { SERVICE_OWN_MEMBERS, serviceModuleSource } from "./fetch/service-module.js";
import { NGRX_MODULE, ngrxModuleSource, refuseActionGroupCollisions } from "./ngrx/ngrx-module.js";
import type { AngularQueryOptions } from "./options.js";

export const QUERIES_ARTEFACT = "queries";
export const SERVICE_ARTEFACT = "service";

export type AngularArtefact = typeof QUERIES_ARTEFACT | typeof SERVICE_ARTEFACT;

const QUERIES_MODULE = "queries";
const SERVICE_MODULE = "service";
const INDEX_MODULE = "index";
const MODULE_EXTENSION = ".ts";

// Per api: the front runtime, `queries.ts`, unless the artefact is off `service.ts` with the HttpClient fetch it sends
// through, with `state: ngrx` the NgRx actions and effects over the service, and an index re-exporting them; or every
// refusal at once.
export function generateAngularQueries(
  input: GenerateInput<AngularQueryOptions, AngularArtefact, "client">,
): GenerateOutcome {
  if (!input.artefacts.has(QUERIES_ARTEFACT)) return { status: "generated", files: [] };

  const { ir, links, options } = input;
  const client = links.client.descriptor;
  const refusals = refuseUnsupportedClientErrorStyle(options.errors, client.errorStyle);

  if (refusals.length > 0) return { status: "refused", refusals };

  const planned = planQueries(ir, client, { infinite: options.infinite === "on" });

  if (planned.status === "refused") return planned;

  const withService = input.artefacts.has(SERVICE_ARTEFACT);
  const serviceRefusals = [
    ...(withService ? refuseServiceMemberCollisions(planned.plan) : []),
    ...refuseStateWithout(options, withService),
    ...(options.state === "ngrx" ? refuseActionGroupCollisions(planned.plan) : []),
  ];

  if (serviceRefusals.length > 0) return { status: "refused", refusals: serviceRefusals };

  const clientSpecifier = (fromFile: string) =>
    importSpecifier(links.client, client.exports.Client, fromFile);
  const files = queriesAndServiceFiles(planned.plan, options, withService, clientSpecifier);

  return { status: "generated", files: [frontRuntimeFile(), ...files], warnings: planned.warnings };
}

function queriesAndServiceFiles(
  plan: QueryPlan,
  options: AngularQueryOptions,
  withService: boolean,
  clientSpecifier: (fromFile: string) => string,
): GeneratedFile[] {
  const queriesFile = `${QUERIES_MODULE}${MODULE_EXTENSION}`;
  const serviceFile = `${SERVICE_MODULE}${MODULE_EXTENSION}`;
  const withNgrx = withService && options.state === "ngrx";
  const queries = fetchQueriesModuleSource(plan, options, {
    client: clientSpecifier(queriesFile),
    runtime: FRONT_RUNTIME_SPECIFIER,
  });
  const serviceFiles = (): GeneratedFile[] => [
    {
      path: `${HTTP_CLIENT_FETCH_MODULE}${MODULE_EXTENSION}`,
      contents: `${HTTP_CLIENT_FETCH_SOURCE}\n`,
    },
    {
      path: serviceFile,
      contents: `${serviceModuleSource(plan, options, {
        client: clientSpecifier(serviceFile),
        queries: `./${QUERIES_MODULE}${FRONT_MODULE_SUFFIX}`,
        runtime: FRONT_RUNTIME_SPECIFIER,
        httpClientFetch: `./${HTTP_CLIENT_FETCH_MODULE}${FRONT_MODULE_SUFFIX}`,
      })}\n`,
    },
  ];
  const ngrxFile = (): GeneratedFile => ({
    path: `${NGRX_MODULE}${MODULE_EXTENSION}`,
    contents: `${ngrxModuleSource(plan, {
      service: `./${SERVICE_MODULE}${FRONT_MODULE_SUFFIX}`,
      queries: `./${QUERIES_MODULE}${FRONT_MODULE_SUFFIX}`,
    })}\n`,
  });
  const indexed: IndexedModule[] = [
    ...(withNgrx ? [{ module: NGRX_MODULE }] : []),
    ...(withService ? [{ module: SERVICE_MODULE }, { module: HTTP_CLIENT_FETCH_MODULE }] : []),
    { module: QUERIES_MODULE },
    { module: FRONT_RUNTIME_MODULE, typeNames: [...FRONT_RUNTIME_TYPE_NAMES], valueNames: [] },
  ];

  return [
    { path: queriesFile, contents: `${queries}\n` },
    ...(withService ? serviceFiles() : []),
    ...(withNgrx ? [ngrxFile()] : []),
    { path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(indexed) },
  ];
}

// The NgRx effects call the service, so `state` without it would shape nothing.
function refuseStateWithout(options: AngularQueryOptions, withService: boolean): Refusal[] {
  if (options.state === undefined || withService) return [];

  return [
    {
      code: "artefact.service.needed",
      message: `The option 'state: ${options.state}' needs the 'service' artefact, which the entry turns off: its effects call the service.`,
      fix: "Add 'service' to the target's `artefacts`, or drop 'state'.",
      member: "",
    },
  ];
}

// An operation member named as one of the service's own members would replace it.
function refuseServiceMemberCollisions(plan: QueryPlan): Refusal[] {
  return plan.operations
    .filter((operation) => SERVICE_OWN_MEMBERS.includes(operation.names.base))
    .map((operation) => ({
      code: "names.collision",
      message: `The operation '${operation.operationId}' would be the service member '${operation.names.base}', which is the service's own.`,
      fix: "Rename the operation in the contract, or turn the 'service' artefact off.",
      member: "",
      operation: operation.operationId,
    }));
}
