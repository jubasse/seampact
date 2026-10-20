import { JSON_SCHEMA_DIALECT, type JsonSchema } from "../authoring/schemas.js";
import type { AppSource } from "./app-config.js";
import { ROOT_CHECKS_SCHEMA, type RootChecks } from "./checks-config.js";
import { NAME_LIST, SOURCE_SCHEMA, SOURCES_SCHEMA } from "./config-schema-parts.js";
import { MERGED_DOCUMENT_SCHEMA, ROOT_OPENAPI_SCHEMA, type RootOpenApi } from "./openapi-config.js";

// The monorepo root config, a `seampact.config.yaml` holding `apps` (ADR 0011 "The app config"): the apps it lists,
// the sources and `allowLocal` they share, its merged OpenAPI documents and their drift check.

export interface RootConfig {
  // The app directories, relative to the root config, each holding its own app config.
  apps: string[];
  sources?: Record<string, AppSource>;
  // The apps' default; an app's own `allowLocal` wins.
  allowLocal?: boolean;
  openapi?: RootOpenApi;
  checks?: RootChecks;
}

// The key that makes a `seampact.config.yaml` a root config.
export const ROOT_CONFIG_MARKER_KEY = "apps";

// The keys of an app config a root config never takes: they belong to one app.
export const APP_ONLY_KEYS = ["outDir", "targets", "diff"] as const;

export const ROOT_CONFIG_SCHEMA: JsonSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: "https://seampact.dev/schemas/config/root.schema.json",
  title: "seampact root config",
  type: "object",
  additionalProperties: false,
  required: [ROOT_CONFIG_MARKER_KEY],
  properties: {
    apps: { ...NAME_LIST, minItems: 1 },
    sources: SOURCES_SCHEMA,
    allowLocal: { type: "boolean" },
    openapi: ROOT_OPENAPI_SCHEMA,
    checks: ROOT_CHECKS_SCHEMA,
  },
  $defs: {
    mergedDocument: MERGED_DOCUMENT_SCHEMA,
    source: SOURCE_SCHEMA,
  },
};
