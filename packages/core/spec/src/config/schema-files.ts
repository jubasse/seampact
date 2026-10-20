import type { JsonSchema } from "../authoring/schemas.js";
import { APP_CONFIG_SCHEMA } from "./app-config.js";
import { ROOT_CONFIG_SCHEMA } from "./root-config.js";

// The committed config schemas under `schemas/config/`, by file name: the definition every runner validates, the
// Gradle and Maven DSLs included (A42), each assembled from its TypeScript constant.
export const CONFIG_SCHEMA_FILES: Readonly<Record<string, JsonSchema>> = {
  "app.schema.json": APP_CONFIG_SCHEMA,
  "root.schema.json": ROOT_CONFIG_SCHEMA,
};
