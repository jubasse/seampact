import { dirname, join, resolve } from "node:path";
import type { TargetRole } from "@seampact/codegen-core";
import {
  type ApiDocumentPlacements,
  type AppOpenApi,
  type DocumentPlacement,
  NO_OPENAPI_DOCUMENTS,
  type OpenApiDocumentOptions,
  type OperationsFilter,
} from "@seampact/spec/config";
import type { CliProblem } from "../cli-problem.js";
import { apiRefsOf, parseApiRef } from "../commands/api-refs.js";
import { isInsideOrEqual } from "./path-containment.js";
import type { LoadedAppConfig } from "./read-app-config.js";
import { documentOptionsOf } from "./read-root-config.js";
import type { LoadedWorkspace } from "./read-workspace-configs.js";

// Which seampact OpenAPI documents an app writes and where (ADR 0011 "Which OpenAPI documents exist", A43), and
// what each merged document of a root takes from its apps.

// The default directory of an app's documents, beside its config file.
const DEFAULT_DOCUMENT_DIRECTORY = "openapi";

const DOCUMENT_EXTENSION = ".yaml";

// A compiled api the app sees, with the ids of the documents it declares (none for an api without `documents`).
export interface ApiDocuments {
  source: string;
  api: string;
  documents: readonly string[];
}

export interface PlannedAppDocument {
  source: string;
  api: string;
  // The api's document id; absent for the one document of an api that declares none.
  document?: string;
  file: string;
  options: OpenApiDocumentOptions;
  // The `operations` of each server entry serving the api, whose union the document holds; absent when one of them
  // serves the whole api, or when `openapi` lists the document.
  servedOperations?: OperationsFilter[];
}

export type AppDocumentPlan =
  | { status: "planned"; documents: PlannedAppDocument[] }
  | { status: "refused"; problems: CliProblem[] };

// What one app gives a merged document: the operations of a server entry's api (its `document` and `operations`
// as the entry writes them), or a document an OpenAPI-only app lists.
export interface MergedContribution {
  app: string;
  // The api as the entry or the `openapi` key names it, `<api>` or `<source>/<api>`.
  api: string;
  entry?: string;
  document?: string;
  operations?: OperationsFilter;
}

export interface PlannedMergedDocument {
  name: string;
  file: string;
  options: OpenApiDocumentOptions;
  prefix: Readonly<Record<string, string>>;
  contributions: MergedContribution[];
}

export type MergedDocumentPlan =
  | { status: "planned"; documents: PlannedMergedDocument[] }
  | { status: "refused"; problems: CliProblem[] };

// The apis the `openapi` key names, each alone: `<source>/<api>` is not a key the config takes.
export function openApiApiNames(config: LoadedAppConfig): string[] {
  const { openapi } = config;

  if (openapi === undefined || openapi === NO_OPENAPI_DOCUMENTS) return [];

  return Object.keys(openapi);
}

// The app's documents: those its `openapi` lists, none for `none`, and without the key every document of every api
// its server targets generate from, at `openapi/<api>.yaml` or `openapi/<api>.<document>.yaml`.
export function planAppDocuments(
  config: LoadedAppConfig,
  entryRoles: ReadonlyMap<string, TargetRole>,
  apiDocuments: readonly ApiDocuments[],
): AppDocumentPlan {
  const planned =
    config.openapi === undefined
      ? defaultDocuments(config, entryRoles, apiDocuments)
      : listedDocuments(config, config.openapi, apiDocuments);

  if (planned.status === "refused") return planned;

  const problems = [
    ...documentInsideOutputProblems(config, planned.documents),
    ...pathConflictProblems(
      planned.documents.map((each) => ({ file: each.file, name: nameOf(each) })),
    ),
  ];

  return problems.length > 0 ? { status: "refused", problems } : planned;
}

// The directory of an app's default documents, beside its config file.
export function defaultDocumentDirectory(config: Pick<LoadedAppConfig, "file">): string {
  return join(dirname(config.file), DEFAULT_DOCUMENT_DIRECTORY);
}

// An api a server entry serves, with the `operations` of each entry serving it (undefined once one serves it all).
interface ServedApi {
  api: ApiDocuments;
  operations: OperationsFilter[] | undefined;
}

function defaultDocuments(
  config: LoadedAppConfig,
  entryRoles: ReadonlyMap<string, TargetRole>,
  apiDocuments: readonly ApiDocuments[],
): AppDocumentPlan {
  const directory = defaultDocumentDirectory(config);
  const served = new Map<string, ServedApi>();
  const problems: CliProblem[] = [];

  for (const { entry } of config.entries) {
    if (roleOf(entryRoles, entry.id) !== "server") continue;

    for (const text of apiRefsOf(entry)) {
      const found = findApi(apiDocuments, text, `entry '${entry.id}'`);

      if (found.status === "refused") problems.push(found.problem);
      else addServedApi(served, found.api, entry.operations);
    }
  }

  if (problems.length > 0) return { status: "refused", problems };

  const documents = [...served.values()].flatMap(({ api, operations }): PlannedAppDocument[] => {
    const servedOperations =
      operations === undefined ? {} : { servedOperations: structuredClone(operations) };

    if (api.documents.length === 0) {
      return [
        {
          source: api.source,
          api: api.api,
          file: join(directory, `${api.api}${DOCUMENT_EXTENSION}`),
          options: {},
          ...servedOperations,
        },
      ];
    }

    return api.documents.map((document) => ({
      source: api.source,
      api: api.api,
      document,
      file: join(directory, `${api.api}.${document}${DOCUMENT_EXTENSION}`),
      options: {},
      ...servedOperations,
    }));
  });

  return { status: "planned", documents };
}

function addServedApi(
  served: Map<string, ServedApi>,
  api: ApiDocuments,
  operations: OperationsFilter | undefined,
): void {
  const key = JSON.stringify([api.source, api.api]);
  const known = served.get(key);

  if (operations === undefined || (known !== undefined && known.operations === undefined)) {
    served.set(key, { api, operations: undefined });

    return;
  }

  served.set(key, { api, operations: [...(known?.operations ?? []), operations] });
}

function listedDocuments(
  config: LoadedAppConfig,
  openapi: AppOpenApi,
  apiDocuments: readonly ApiDocuments[],
): AppDocumentPlan {
  if (openapi === NO_OPENAPI_DOCUMENTS) return { status: "planned", documents: [] };

  const directory = dirname(config.file);
  const documents: PlannedAppDocument[] = [];
  const problems: CliProblem[] = [];

  for (const [apiName, placements] of Object.entries(openapi)) {
    const found = findApi(apiDocuments, apiName, `openapi.${apiName}`);

    if (found.status === "refused") {
      problems.push(found.problem);
      continue;
    }

    const planned = apiPlacements(directory, found.api, placements);

    if (planned.status === "refused") problems.push(...planned.problems);
    else documents.push(...planned.documents);
  }

  return problems.length > 0 ? { status: "refused", problems } : { status: "planned", documents };
}

function apiPlacements(
  directory: string,
  api: ApiDocuments,
  placements: ApiDocumentPlacements,
): AppDocumentPlan {
  const where = `openapi.${api.api}`;

  if (isOnePlacement(placements)) {
    const [onlyDocument, ...others] = api.documents;

    if (others.length > 0) {
      return refused({
        code: "config.openapi.document-needed",
        message: `The api '${api.api}' declares the documents ${api.documents.join(", ")}, and 'openapi.${api.api}' gives one path.`,
        fix: `Map each document to its path: '${api.api}: { ${api.documents[0]}: openapi/${api.api}.${api.documents[0]}.yaml }'.`,
        where,
      });
    }

    const document = onlyDocument === undefined ? {} : { document: onlyDocument };

    return {
      status: "planned",
      documents: [
        { source: api.source, api: api.api, ...document, ...placed(directory, placements) },
      ],
    };
  }

  if (api.documents.length === 0) {
    return refused({
      code: "config.openapi.no-documents",
      message: `The api '${api.api}' declares no \`documents\`, and 'openapi.${api.api}' maps document ids.`,
      fix: "Give the path of the api's one document instead of a mapping.",
      where,
    });
  }

  const unknown = Object.keys(placements).filter((document) => !api.documents.includes(document));

  if (unknown.length > 0) {
    return {
      status: "refused",
      problems: unknown.map((document) => ({
        code: "config.openapi.unknown-document",
        message: `The api '${api.api}' declares no document '${document}' (${api.documents.join(", ")}).`,
        fix: "Map the documents the api's `documents` declares.",
        where: `${where}.${document}`,
      })),
    };
  }

  return {
    status: "planned",
    documents: Object.entries(placements).map(([document, placement]) => ({
      source: api.source,
      api: api.api,
      document,
      ...placed(directory, placement),
    })),
  };
}

// A path or a placed document, told from a mapping of document ids by its required `path`.
function isOnePlacement(placements: ApiDocumentPlacements): placements is DocumentPlacement {
  return typeof placements === "string" || typeof placements.path === "string";
}

function placed(
  directory: string,
  placement: DocumentPlacement,
): { file: string; options: OpenApiDocumentOptions } {
  if (typeof placement === "string") return { file: resolve(directory, placement), options: {} };

  return { file: resolve(directory, placement.path), options: documentOptionsOf(placement) };
}

type FoundApi = { status: "found"; api: ApiDocuments } | { status: "refused"; problem: CliProblem };

// An api named `<api>` or `<source>/<api>`; an api named alone must be the only one of that name.
function findApi(apiDocuments: readonly ApiDocuments[], text: string, where: string): FoundApi {
  const { source, api } = parseApiRef(text);
  const candidates = apiDocuments.filter(
    (each) => each.api === api && (source === undefined || each.source === source),
  );
  const [found] = candidates;

  if (candidates.length > 1) {
    return {
      status: "refused",
      problem: {
        code: "config.openapi.ambiguous-api",
        message: `The api '${api}' exists in the sources ${candidates.map((each) => `'${each.source}'`).join(", ")}, and 'openapi' names an api alone.`,
        fix: "An `openapi` key names an api alone: rename the api in the `workspace.yaml` of one of these sources, or remove one of them from the config that defines it (this app config or its root config).",
        where,
      },
    };
  }

  if (found === undefined) {
    return {
      status: "refused",
      problem: {
        code: "config.openapi.unknown-api",
        message: `No source of the app config holds an api '${text}'.`,
        fix: "Name an api of a source's `workspace.yaml`.",
        where,
      },
    };
  }

  return { status: "found", api: found };
}

// A document inside an entry's output directory would be removed or replaced by that entry's writer.
function documentInsideOutputProblems(
  config: LoadedAppConfig,
  documents: readonly PlannedAppDocument[],
): CliProblem[] {
  return documents.flatMap((document) =>
    config.entries
      .filter(({ root }) => isInsideOrEqual(root, document.file))
      .map(({ entry }) => ({
        code: "config.openapi.inside-output",
        message: `The document ${document.file} lies inside the output directory of the entry '${entry.id}'.`,
        fix: "Write the document outside every entry's `out` directory, as the default `openapi/` does.",
        where: `openapi.${nameOf(document)}`,
      })),
  );
}

function pathConflictProblems(documents: readonly { file: string; name: string }[]): CliProblem[] {
  return documents.flatMap((document, index) => {
    const first = documents.slice(0, index).find((other) => other.file === document.file);

    if (first === undefined) return [];

    return [
      {
        code: "config.openapi.path-conflict",
        message: `The documents '${first.name}' and '${document.name}' are both written to ${document.file}.`,
        fix: "Give each document its own path.",
        where: `openapi.${document.name}`,
      },
    ];
  });
}

function nameOf(document: PlannedAppDocument): string {
  return document.document === undefined ? document.api : `${document.api}.${document.document}`;
}

function roleOf(entryRoles: ReadonlyMap<string, TargetRole>, entryId: string): TargetRole {
  const role = entryRoles.get(entryId);

  if (role === undefined) throw new Error(`no resolved target role for the entry ${entryId}`);

  return role;
}

// Each merged document of the root with what each app it covers contributes (ADR 0011 "Which OpenAPI documents
// exist"): a server entry's apis, else an OpenAPI-only app's listed documents; an app with no server target and
// some target contributes nothing. `rolesByApp` holds each app's entry roles, by the app's name in `apps`.
export function planMergedDocuments(
  workspace: LoadedWorkspace,
  rolesByApp: ReadonlyMap<string, ReadonlyMap<string, TargetRole>>,
): MergedDocumentPlan {
  const documents = workspace.root.openapi.map((merged) => ({
    name: merged.name,
    file: merged.file,
    options: structuredClone(merged.options),
    prefix: structuredClone(merged.prefix),
    contributions: merged.apps.flatMap((appName) => {
      const app = workspace.apps.find((each) => each.app.name === appName);

      if (app === undefined) throw new Error(`the workspace has no app ${appName}`);

      return appContributions(appName, app.config, rolesByApp.get(appName));
    }),
  }));
  const problems = pathConflictProblems(documents);

  return problems.length > 0 ? { status: "refused", problems } : { status: "planned", documents };
}

function appContributions(
  appName: string,
  config: LoadedAppConfig,
  entryRoles: ReadonlyMap<string, TargetRole> | undefined,
): MergedContribution[] {
  if (config.entries.length > 0) {
    if (entryRoles === undefined) throw new Error(`no entry roles for the app ${appName}`);

    return config.entries
      .filter(({ entry }) => roleOf(entryRoles, entry.id) === "server")
      .flatMap(({ entry }) =>
        apiRefsOf(entry).map((api) => ({
          app: appName,
          api,
          entry: entry.id,
          ...(entry.document === undefined ? {} : { document: entry.document }),
          ...(entry.operations === undefined
            ? {}
            : { operations: structuredClone(entry.operations) }),
        })),
      );
  }

  const { openapi } = config;

  if (openapi === undefined || openapi === NO_OPENAPI_DOCUMENTS) return [];

  return Object.entries(openapi).flatMap(([api, placements]) =>
    isOnePlacement(placements)
      ? [{ app: appName, api }]
      : Object.keys(placements).map((document) => ({ app: appName, api, document })),
  );
}

function refused(problem: CliProblem): AppDocumentPlan {
  return { status: "refused", problems: [problem] };
}
