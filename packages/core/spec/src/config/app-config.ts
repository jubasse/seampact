import { JSON_SCHEMA_DIALECT, type JsonSchema } from "../authoring/schemas.js";

// The app config, `seampact.config.yaml` (ADR 0011 "The app config"), in the keys the Node CLI reads today. The
// other keys of ADR 0011 are refused by name by the CLI until the lane that brings them lands.

export const APP_CONFIG_FILE_NAME = "seampact.config.yaml";

// The one directory of the app's generated code, beside the config file, when `outDir` is absent (A41).
export const DEFAULT_OUT_DIR = "__generated__";

export interface AppConfig {
  outDir?: string;
  sources?: Record<string, PathSource>;
  targets?: TargetEntry[];
}

// A contract workspace directory, relative to the config file.
export interface PathSource {
  path: string;
}

export interface TargetEntry {
  id: string;
  // The npm package of the target, resolved from the config file's directory (ADR 0009).
  use: string;
  api?: string;
  apis?: string[];
  document?: string;
  // Relative to `outDir`; the entry's `id` when absent.
  out?: string;
  // The provider entry id of each link kind the target consumes.
  link?: Record<string, string>;
  options?: Record<string, unknown>;
  operations?: OperationsFilter;
  // The switches of a server target's boot check (ADR 0012); the other artefact switches wait.
  artefacts?: ArtefactSwitches;
  // The server's routes outside the contract the boot check accepts (ADR 0011, ADR 0012).
  frameworkRoutes?: FrameworkRouteEntry[];
}

export interface ArtefactSwitches {
  bootCheck?: { frameworkRoutes?: boolean };
}

// A path or a pattern (`*` one segment, `**` any number), for one method or every method, with its reason.
export interface FrameworkRouteEntry {
  method?: HttpMethod;
  path: string;
  reason: string;
}

export type HttpMethod = (typeof HTTP_METHODS)[number];

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

// Operation ids or tags; an empty or absent `include` keeps every operation.
export interface OperationsFilter {
  include?: string[];
  exclude?: string[];
}

const ENTRY_ID_PATTERN = "^[A-Za-z][A-Za-z0-9_-]*$";

const nonEmptyString = { type: "string", minLength: 1 };

const nameList = { type: "array", items: nonEmptyString, uniqueItems: true };

// A path from the root whose segments are literal, `*` or `**`; a star never sits inside a segment.
const FRAMEWORK_ROUTE_PATH_PATTERN = "^/(?:(?:[^/*]+|\\*|\\*\\*)(?:/(?:[^/*]+|\\*|\\*\\*))*)?$";

export const APP_CONFIG_SCHEMA: JsonSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: "https://seampact.dev/schemas/config/app.json",
  title: "seampact app config",
  type: "object",
  additionalProperties: false,
  properties: {
    outDir: nonEmptyString,
    sources: {
      type: "object",
      propertyNames: { pattern: ENTRY_ID_PATTERN },
      additionalProperties: { $ref: "#/$defs/pathSource" },
    },
    targets: { type: "array", items: { $ref: "#/$defs/targetEntry" } },
  },
  $defs: {
    frameworkRoute: {
      type: "object",
      additionalProperties: false,
      required: ["path", "reason"],
      properties: {
        method: { enum: [...HTTP_METHODS] },
        path: { type: "string", pattern: FRAMEWORK_ROUTE_PATH_PATTERN },
        reason: nonEmptyString,
      },
    },
    pathSource: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: { path: nonEmptyString },
    },
    targetEntry: {
      type: "object",
      additionalProperties: false,
      required: ["id", "use"],
      properties: {
        id: { type: "string", pattern: ENTRY_ID_PATTERN },
        use: nonEmptyString,
        api: nonEmptyString,
        apis: { ...nameList, minItems: 1 },
        document: nonEmptyString,
        out: nonEmptyString,
        link: {
          type: "object",
          additionalProperties: { type: "string", pattern: ENTRY_ID_PATTERN },
        },
        options: { type: "object" },
        operations: {
          type: "object",
          additionalProperties: false,
          properties: { include: nameList, exclude: nameList },
        },
        artefacts: {
          type: "object",
          additionalProperties: false,
          properties: {
            bootCheck: {
              type: "object",
              additionalProperties: false,
              properties: { frameworkRoutes: { type: "boolean" } },
            },
          },
        },
        frameworkRoutes: { type: "array", items: { $ref: "#/$defs/frameworkRoute" } },
      },
      oneOf: [
        { required: ["api"], not: { required: ["apis"] } },
        { required: ["apis"], not: { required: ["api"] } },
      ],
    },
  },
};
