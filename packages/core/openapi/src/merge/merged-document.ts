import { isDeepStrictEqual } from "node:util";
import { compareCodeUnits, type Refusal } from "@seampact/codegen-core";
import { mostUsedFormat, OPENAPI_VERSION, pathsByRoute, serversArray } from "../documents.js";
import { isExtensionSelected } from "../emit-context.js";
import { EXTENSION_PREFIX } from "../extension-names.js";
import { isJsonObject, type JsonObject, type JsonValue, objectMember } from "../json-value.js";
import type { MergeOptions } from "./merge-documents.js";

// The api documents of a merged document written as one: an element two apis write identically is kept once, two
// different elements under one name are refused with the `prefix` fix, and a method and path is always one api's.

/** One api's document, mapped and prefixed, with what `x-seampact-api` says of the api. */
export interface ApiSource {
  api: string;
  apiValue: JsonObject;
  document: JsonObject;
}

const FORMAT_EXTENSION = `${EXTENSION_PREFIX}format`;
const API_EXTENSION = `${EXTENSION_PREFIX}api`;
const COMPONENT_SECTIONS = ["schemas", "securitySchemes"] as const;
// The root members an api document holds besides its consumer extensions, each merged below.
const MERGED_ROOT_MEMBERS: readonly string[] = [
  "openapi",
  "info",
  "servers",
  "tags",
  API_EXTENSION,
  FORMAT_EXTENSION,
  "paths",
  "components",
];

// An element placed in the merged document, with the api it came from and how a refusal names it.
interface Placed {
  api: string;
  label: string;
  value: JsonValue;
}

// A placed operation, with where it answers.
interface PlacedOperation extends Placed {
  path: string;
  method: string;
}

type ClashKind = "name" | "route" | "path";

// A path template with its parameter names blanked: two paths of one shape are one path (OAS 3.1).
const PATH_PARAMETER = /\{[^{}]+\}/g;

interface Assembly {
  refusals: Refusal[];
  tags: Map<string, Placed>;
  headers: Map<string, Placed>;
  pathSpellings: Map<string, Placed>;
  routes: Map<string, PlacedOperation>;
  operationIds: Map<string, Placed>;
  components: Map<string, Map<string, Placed>>;
}

export function assembleMergedDocument(
  sources: readonly ApiSource[],
  options: MergeOptions,
): { document: JsonObject; refusals: Refusal[] } {
  const assembly: Assembly = {
    refusals: [],
    tags: new Map(),
    headers: new Map(),
    pathSpellings: new Map(),
    routes: new Map(),
    operationIds: new Map(),
    components: new Map(COMPONENT_SECTIONS.map((section) => [section, new Map()])),
  };

  for (const source of sources) placeSource(assembly, source);

  return { document: mergedDocument(assembly, options), refusals: assembly.refusals };
}

function placeSource(assembly: Assembly, source: ApiSource): void {
  const { api, document } = source;

  for (const member of Object.keys(document)) {
    if (!MERGED_ROOT_MEMBERS.includes(member) && !isConsumerExtension(member)) {
      throw new Error(
        `the merge does not know the document member '${member}' of the api ${api}: give it a merge rule beside its table row`,
      );
    }
  }

  place(
    assembly,
    assembly.headers,
    api,
    { api, label: `the api '${api}'`, value: apiHeader(source) },
    "name",
  );

  for (const tag of arrayMember(document, "tags")) {
    const name = stringMember(tag, "name", `a tag of the api ${api}`);

    place(assembly, assembly.tags, name, { api, label: `the tag '${name}'`, value: tag }, "name");
  }

  placeComponents(assembly, api, objectMember(document, "components"));
  placeOperations(assembly, api, document);
}

function placeComponents(assembly: Assembly, api: string, components: JsonObject): void {
  for (const section of Object.keys(components)) {
    const placed = assembly.components.get(section);

    if (placed === undefined) {
      throw new Error(
        `the merge does not know the component section '${section}' of the api ${api}: give it a merge rule beside its table row`,
      );
    }

    for (const [key, value] of Object.entries(objectMember(components, section))) {
      place(
        assembly,
        placed,
        key,
        { api, label: `the component '${section}.${key}'`, value },
        "name",
      );
    }
  }
}

// Each operation carries its format explicitly while placed, so two operations compare by what they say, whichever
// format their api's document had.
function placeOperations(assembly: Assembly, api: string, document: JsonObject): void {
  const documentFormat = document[FORMAT_EXTENSION];

  for (const [path, pathItem] of Object.entries(objectMember(document, "paths"))) {
    if (!isJsonObject(pathItem)) continue;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!isJsonObject(operation)) continue;

      const placedOperation: JsonObject = { ...operation };

      if (placedOperation[FORMAT_EXTENSION] === undefined && documentFormat !== undefined) {
        placedOperation[FORMAT_EXTENSION] = documentFormat;
      }

      const route = `${method.toUpperCase()} ${path}`;
      const operationId = stringMember(operation, "operationId", `the operation ${route}`);
      const label = `the operation '${operationId}' (${route})`;
      const pathShape = path.replace(PATH_PARAMETER, "{}");

      place(
        assembly,
        assembly.pathSpellings,
        pathShape,
        { api, label: `the path '${path}'`, value: path },
        "path",
      );
      place(
        assembly,
        assembly.routes,
        JSON.stringify([pathShape, method]),
        { api, label, value: placedOperation, path, method },
        "route",
      );
      place(assembly, assembly.operationIds, operationId, { api, label, value: route }, "name");
    }
  }
}

// The first element under a key stays; an equal one is the same element, except one route of two apis.
function place<Entry extends Placed>(
  assembly: Assembly,
  placed: Map<string, Entry>,
  key: string,
  candidate: Entry,
  kind: ClashKind,
): void {
  const first = placed.get(key);

  if (first === undefined) {
    placed.set(key, candidate);

    return;
  }

  const sameValue = isDeepStrictEqual(first.value, candidate.value);
  const routeOfTwoApis = kind === "route" && first.api !== candidate.api;

  if (sameValue && !routeOfTwoApis) return;

  assembly.refusals.push(clashRefusal(first, candidate, kind));
}

function clashRefusal(first: Placed, second: Placed, kind: ClashKind): Refusal {
  const message = `${first.label} of the api '${first.api}' and ${second.label} of the api '${second.api}'`;

  if (first.api === second.api) {
    return {
      code: "openapi.merge.api-versions",
      message: `${message} differ: two apps give different versions of the api.`,
      fix: `Build every app the merged document covers from the same version of the api '${first.api}', or give two different apis distinct api ids.`,
    };
  }

  if (kind === "route") {
    return {
      code: "openapi.merge.route-clash",
      message: `${message} answer the same method and path.`,
      fix: "Give one of the operations a distinct contract path, or write the apis in separate merged documents.",
    };
  }

  if (kind === "path") {
    return {
      code: "openapi.merge.route-clash",
      message: `${message} are one path under different parameter names.`,
      fix: "Give the path parameters the same names in both contracts, or write the apis in separate merged documents.",
    };
  }

  return {
    code: "openapi.merge.name-clash",
    message: `${message} are different elements under one name.`,
    fix: `Set a prefix for '${first.api}' or '${second.api}' in the merged document's 'prefix', such as '${second.api}: ${second.api}'.`,
  };
}

function mergedDocument(assembly: Assembly, options: MergeOptions): JsonObject {
  const { emitter } = options;
  const document: JsonObject = {
    openapi: OPENAPI_VERSION,
    info: { title: options.name, version: mergedVersion(assembly) },
  };

  if (emitter.servers.length > 0) document.servers = serversArray(emitter);

  const tags = sortedValues(assembly.tags);

  if (tags.length > 0) document.tags = tags;

  if (isExtensionSelected(emitter.extensions, "apis")) {
    document[`${EXTENSION_PREFIX}apis`] = sortedValues(assembly.headers);
  }

  const operations = [...assembly.routes.values()];
  const format = mostUsedFormat(
    operations.flatMap(({ value }) =>
      isJsonObject(value) && typeof value[FORMAT_EXTENSION] === "string"
        ? [value[FORMAT_EXTENSION]]
        : [],
    ),
  );

  if (format !== undefined) document[FORMAT_EXTENSION] = format;

  document.paths = mergedPaths(
    assembly,
    format,
    isExtensionSelected(emitter.extensions, "source-api"),
  );

  const components: JsonObject = {};

  for (const [section, placed] of assembly.components) {
    if (placed.size > 0)
      components[section] = Object.fromEntries(
        sortedEntries(placed).map(([key, { value }]) => [key, value]),
      );
  }

  if (Object.keys(components).length > 0) document.components = components;

  return document;
}

// `info.version` is required: each api's version, by api name. One api in two versions is refused before.
function mergedVersion(assembly: Assembly): string {
  return sortedEntries(assembly.headers)
    .map(([api, { value }]) => `${api} ${stringMember(value, "version", `the api ${api}`)}`)
    .join(", ");
}

// An `x-seampact-apis` item: what `x-seampact-api` says of the api, with its version, docs and root consumer
// extensions, which the merged document's root cannot hold for each api.
function apiHeader(source: ApiSource): JsonObject {
  const { api, apiValue, document } = source;
  const info = objectMember(document, "info");
  const header: JsonObject = {
    name: api,
    ...apiValue,
    version: stringMember(info, "version", `the info of the api ${api}`),
  };

  if (info.summary !== undefined) header.summary = info.summary;

  if (info.description !== undefined) header.description = info.description;

  for (const [member, value] of Object.entries(document)) {
    if (isConsumerExtension(member)) header[member] = value;
  }

  return header;
}

function mergedPaths(
  assembly: Assembly,
  documentFormat: string | undefined,
  writeSourceApi: boolean,
): JsonObject {
  return pathsByRoute(
    [...assembly.routes.values()],
    (placed) => placed,
    (placed) => mergedOperation(placed, documentFormat, writeSourceApi),
  );
}

function mergedOperation(
  placed: Placed,
  documentFormat: string | undefined,
  writeSourceApi: boolean,
): JsonObject {
  const operation: JsonObject = isJsonObject(placed.value) ? { ...placed.value } : {};

  if (operation[FORMAT_EXTENSION] === documentFormat) delete operation[FORMAT_EXTENSION];

  if (writeSourceApi) operation[`${EXTENSION_PREFIX}source-api`] = placed.api;

  return operation;
}

function sortedEntries(placed: ReadonlyMap<string, Placed>): [string, Placed][] {
  return [...placed.entries()].sort(([left], [right]) => compareCodeUnits(left, right));
}

function sortedValues(placed: ReadonlyMap<string, Placed>): JsonValue[] {
  return sortedEntries(placed).map(([, { value }]) => value);
}

function isConsumerExtension(member: string): boolean {
  return member.startsWith("x-") && !member.startsWith(EXTENSION_PREFIX);
}

function arrayMember(object: JsonObject, member: string): JsonValue[] {
  const value = object[member];

  return Array.isArray(value) ? value : [];
}

// A string member the api's document always holds; a missing one is a mapping defect, never a key.
function stringMember(value: JsonValue, member: string, holder: string): string {
  const memberValue = isJsonObject(value) ? value[member] : undefined;

  if (typeof memberValue !== "string") {
    throw new Error(
      `the merge reads no string '${member}' in ${holder}: the api's document mapping must write it`,
    );
  }

  return memberValue;
}
