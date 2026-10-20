import type { JsonSchema } from "../authoring/schemas.js";
import { ENTRY_ID_PATTERN, NAME_LIST, NON_EMPTY_STRING } from "./config-schema-parts.js";

// The `openapi` keys of the app and root configs (ADR 0011 "The app config", "Which OpenAPI documents exist"): which
// seampact documents an app writes, where, and with which emitter options (A40, A43).

// `openapi: none`: the app writes no seampact document.
export const NO_OPENAPI_DOCUMENTS = "none";

// An app's `openapi`: none, or each api's documents by api name.
export type AppOpenApi = typeof NO_OPENAPI_DOCUMENTS | Record<string, ApiDocumentPlacements>;

// An api's one document, or each document the api declares by its id (ADR 0002 section 5).
export type ApiDocumentPlacements = DocumentPlacement | Record<string, DocumentPlacement>;

// A document's path, relative to the config file, or the path with the document's emitter options.
export type DocumentPlacement = string | PlacedDocument;

export interface PlacedDocument extends OpenApiDocumentOptions {
  path: string;
}

// The emitter options of ADR 0004 section 12, as the config writes them; each takes its default when absent.
export interface OpenApiDocumentOptions {
  extensions?: ExtensionsOption;
  reasons?: (typeof REASONS_OPTIONS)[number];
  inputSchemas?: (typeof INPUT_SCHEMAS_OPTIONS)[number];
  servers?: OpenApiServer[];
}

export type ExtensionsOption = "all" | "none" | string[];

export interface OpenApiServer {
  url: string;
  description?: string;
}

// The emitter option keys, the keys a placed document takes beside `path`.
export const OPENAPI_DOCUMENT_OPTION_KEYS = [
  "extensions",
  "reasons",
  "inputSchemas",
  "servers",
] as const;

const REASONS_OPTIONS = ["include", "omit"] as const;
const INPUT_SCHEMAS_OPTIONS = ["shared", "strict"] as const;

// A merged document of a monorepo root: the apps it covers (every app of `apps` when absent) and a prefix per api
// for its operation ids and component keys.
export interface MergedDocumentEntry extends PlacedDocument {
  apps?: string[];
  prefix?: Record<string, string>;
}

// A root's `openapi`: each merged document by its name.
export type RootOpenApi = Record<string, MergedDocumentEntry>;

// An extension name as `x-seampact-<name>` ends; `@seampact/openapi` checks it is one it writes.
const EXTENSION_NAME_PATTERN = "^[a-z][A-Za-z0-9-]*$";

const OPTION_PROPERTIES: Record<(typeof OPENAPI_DOCUMENT_OPTION_KEYS)[number], JsonSchema> = {
  extensions: {
    oneOf: [
      { enum: ["all", "none"] },
      {
        type: "array",
        items: { type: "string", pattern: EXTENSION_NAME_PATTERN },
        uniqueItems: true,
      },
    ],
  },
  reasons: { enum: [...REASONS_OPTIONS] },
  inputSchemas: { enum: [...INPUT_SCHEMAS_OPTIONS] },
  servers: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: { url: NON_EMPTY_STRING, description: { type: "string" } },
    },
  },
};

// The `$defs` the app's `openapi` refers to. A placed document is told from a document mapping by its required
// `path`.
export const APP_OPENAPI_SCHEMA_DEFS: Record<string, JsonSchema> = {
  placedDocument: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: { path: NON_EMPTY_STRING, ...OPTION_PROPERTIES },
  },
  documentPlacement: {
    oneOf: [NON_EMPTY_STRING, { $ref: "#/$defs/placedDocument" }],
  },
  apiDocuments: {
    oneOf: [
      NON_EMPTY_STRING,
      { $ref: "#/$defs/placedDocument" },
      {
        type: "object",
        not: { required: ["path"] },
        minProperties: 1,
        propertyNames: { pattern: ENTRY_ID_PATTERN },
        additionalProperties: { $ref: "#/$defs/documentPlacement" },
      },
    ],
  },
};

// The root's merged document entry, its `$defs/mergedDocument`.
export const MERGED_DOCUMENT_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["path"],
  properties: {
    path: NON_EMPTY_STRING,
    apps: { ...NAME_LIST, minItems: 1 },
    prefix: {
      type: "object",
      propertyNames: { pattern: ENTRY_ID_PATTERN },
      additionalProperties: { type: "string", pattern: ENTRY_ID_PATTERN },
    },
    ...OPTION_PROPERTIES,
  },
};

export const APP_OPENAPI_SCHEMA: JsonSchema = {
  oneOf: [
    { const: NO_OPENAPI_DOCUMENTS },
    {
      type: "object",
      propertyNames: { pattern: ENTRY_ID_PATTERN },
      additionalProperties: { $ref: "#/$defs/apiDocuments" },
    },
  ],
};

export const ROOT_OPENAPI_SCHEMA: JsonSchema = {
  type: "object",
  propertyNames: { pattern: ENTRY_ID_PATTERN },
  additionalProperties: { $ref: "#/$defs/mergedDocument" },
};
