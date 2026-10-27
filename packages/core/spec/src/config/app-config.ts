import { JSON_SCHEMA_DIALECT, type JsonSchema } from "../authoring/schemas.js";
import { APP_CHECKS_SCHEMA, type AppChecks } from "./checks-config.js";
import {
  ENTRY_ID_PATTERN,
  NAME_LIST,
  NON_EMPTY_STRING,
  SOURCE_SCHEMA,
  SOURCES_SCHEMA,
} from "./config-schema-parts.js";
import { APP_OPENAPI_SCHEMA, APP_OPENAPI_SCHEMA_DEFS, type AppOpenApi } from "./openapi-config.js";
import { APP_WARNINGS_SCHEMA, type AppWarnings } from "./warnings-config.js";

// The app config, `seampact.config.yaml` (ADR 0011 "The app config"), in the keys the Node CLI reads today. The
// other keys of ADR 0011 are refused by name by the CLI until the lane that brings them lands.

export const APP_CONFIG_FILE_NAME = "seampact.config.yaml";

// The one directory of the app's generated code, beside the config file, when `outDir` is absent (A41).
export const DEFAULT_OUT_DIR = "__generated__";

export interface AppConfig {
  // False refuses `path` sources (ADR 0011 "Refusing local sources on shared branches"); true when absent.
  allowLocal?: boolean;
  outDir?: string;
  sources?: Record<string, AppSource>;
  targets?: TargetEntry[];
  // The seampact OpenAPI documents the app writes; absent, those of A43's default.
  openapi?: AppOpenApi;
  checks?: AppChecks;
  diff?: DiffConfig;
  // The generate warnings the app silences, by form.
  warnings?: AppWarnings;
}

// How `seampact diff` gates a release under `compat.policy: additive-only` (FR-13); the contract never sets it.
export interface DiffConfig {
  // `clients` fails on changes that break clients, `both` on those that break clients or servers.
  gate?: DiffGateScope;
  // The breaking changes reported but not gated; both when absent.
  exempt?: DiffExemption[];
}

export const DIFF_GATE_SCOPES = ["clients", "both"] as const;

export type DiffGateScope = (typeof DIFF_GATE_SCOPES)[number];

// `experimental`: a change on an operation experimental in the baseline; `sunsetPassed`: removing an operation
// whose sunset is on or before today.
export const DIFF_EXEMPTIONS = ["experimental", "sunsetPassed"] as const;

export type DiffExemption = (typeof DIFF_EXEMPTIONS)[number];

// Changes breaking servers only are reported but pass: the producer's regenerated server catches them at type
// check; `both` suits contracts other teams implement.
export const DEFAULT_DIFF_GATE: DiffGateScope = "clients";

export const DEFAULT_DIFF_EXEMPTIONS: readonly DiffExemption[] = DIFF_EXEMPTIONS;

export type AppSource = PathSource | BundleSource;

// A contract workspace directory, relative to the config file.
export interface PathSource {
  path: string;
}

// A pinned contract bundle (ADR 0011 "Channels"); `integrity` is optional so that pinning is a copy of the value
// the check prints.
export type BundleSource =
  | PackageBundleSource
  | ReleaseBundleSource
  | GitBundleSource
  | MavenBundleSource;

// An npm package installed in the app's project, resolved from the config file's directory.
export interface PackageBundleSource {
  package: string;
  version: string;
  integrity?: string;
}

// A bundle tarball served over HTTPS.
export interface ReleaseBundleSource {
  release: { url: string };
  integrity?: string;
}

// A bundle directory in a git repository at a tag; the repository root when `directory` is absent.
export interface GitBundleSource {
  git: { url: string; tag: string; directory?: string };
  integrity?: string;
}

// A bundle tarball published as a Maven artefact, `groupId:artifactId:version`, which a JVM build resolves through its
// own repositories (ADR 0010); the Node CLI refuses it by name.
export interface MavenBundleSource {
  maven: string;
  integrity?: string;
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
  // Each artefact the target declares, switched on or off; absent, the target's default (ADR 0009).
  artefacts?: ArtefactSwitches;
  // Framework majors the compatibility matrix has not tested, accepted without its warning: `<framework>@<major>`.
  allowUntested?: string[];
  // The server's routes outside the contract the boot check accepts (ADR 0011, ADR 0012).
  frameworkRoutes?: FrameworkRouteEntry[];
  // `off` asks the target to switch its framework's own OpenAPI document off; `keep` when absent (ADR 0011).
  frameworkDocs?: FrameworkDocsSwitch;
}

export const FRAMEWORK_DOCS_SWITCHES = ["keep", "off"] as const;

export type FrameworkDocsSwitch = (typeof FRAMEWORK_DOCS_SWITCHES)[number];

// By artefact id; `bootCheck` also takes its checks apart (ADR 0012), its object form leaving the artefact on.
export interface ArtefactSwitches {
  [artefact: string]: boolean | BootCheckSwitches | undefined;
  bootCheck?: boolean | BootCheckSwitches;
}

export interface BootCheckSwitches {
  frameworkRoutes?: boolean;
  // How the boot check treats a hook the contract needs and the app did not register; `error` when absent.
  hooks?: HookBootCheckLevel;
}

export const HOOK_BOOT_CHECK_LEVELS = ["error", "warn", "off"] as const;

export type HookBootCheckLevel = (typeof HOOK_BOOT_CHECK_LEVELS)[number];

// The key `bootCheck` takes in its object form.
export const BOOT_CHECK_ARTEFACT = "bootCheck";

// An artefact id as a target declares it and an app config switches it: a name every DSL can write as a key.
export const ARTEFACT_ID_PATTERN = "^[a-z][A-Za-z0-9]*$";

// `<framework>@<major>`, the framework by its id in the compatibility matrix.
export const ALLOW_UNTESTED_PATTERN = "^[a-z][a-z0-9-]*@(0|[1-9][0-9]*)$";

// A path or a pattern (`*` one segment, `**` any number, a `*` inside a segment any characters but `/`), for one
// method or every method, with its reason.
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

// A path from the root whose segments are `*`, `**`, or literal text with at most two single stars inside
// (`livewire-*`, `*-x-*`); two stars side by side are always a whole segment. `?`, `{` and `}` are refused: Spring
// reads them as wildcards and the other targets as literals, and `*` or `**` covers each of their uses.
const FRAMEWORK_ROUTE_LITERAL = "[^/*?{}]+";
const FRAMEWORK_ROUTE_SEGMENT = [
  "\\*\\*",
  "\\*",
  `\\*?${FRAMEWORK_ROUTE_LITERAL}\\*?`,
  `\\*?${FRAMEWORK_ROUTE_LITERAL}\\*${FRAMEWORK_ROUTE_LITERAL}`,
  `${FRAMEWORK_ROUTE_LITERAL}\\*${FRAMEWORK_ROUTE_LITERAL}\\*`,
]
  .map((form) => `(?:${form})`)
  .join("|");
const FRAMEWORK_ROUTE_PATH_PATTERN = `^/(?:(?:${FRAMEWORK_ROUTE_SEGMENT})(?:/(?:${FRAMEWORK_ROUTE_SEGMENT}))*)?$`;

export const APP_CONFIG_SCHEMA: JsonSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: "https://seampact.dev/schemas/config/app.schema.json",
  title: "seampact app config",
  type: "object",
  additionalProperties: false,
  properties: {
    allowLocal: { type: "boolean" },
    outDir: NON_EMPTY_STRING,
    sources: SOURCES_SCHEMA,
    targets: { type: "array", items: { $ref: "#/$defs/targetEntry" } },
    openapi: APP_OPENAPI_SCHEMA,
    checks: APP_CHECKS_SCHEMA,
    warnings: APP_WARNINGS_SCHEMA,
    diff: {
      type: "object",
      additionalProperties: false,
      properties: {
        gate: { enum: [...DIFF_GATE_SCOPES] },
        exempt: { type: "array", items: { enum: [...DIFF_EXEMPTIONS] }, uniqueItems: true },
      },
    },
  },
  $defs: {
    ...APP_OPENAPI_SCHEMA_DEFS,
    frameworkRoute: {
      type: "object",
      additionalProperties: false,
      required: ["path", "reason"],
      properties: {
        method: { enum: [...HTTP_METHODS] },
        path: { type: "string", pattern: FRAMEWORK_ROUTE_PATH_PATTERN },
        reason: NON_EMPTY_STRING,
      },
    },
    source: SOURCE_SCHEMA,
    targetEntry: {
      type: "object",
      additionalProperties: false,
      required: ["id", "use"],
      properties: {
        id: { type: "string", pattern: ENTRY_ID_PATTERN },
        use: NON_EMPTY_STRING,
        api: NON_EMPTY_STRING,
        apis: { ...NAME_LIST, minItems: 1 },
        document: NON_EMPTY_STRING,
        out: NON_EMPTY_STRING,
        link: {
          type: "object",
          propertyNames: { pattern: ENTRY_ID_PATTERN },
          additionalProperties: { type: "string", pattern: ENTRY_ID_PATTERN },
        },
        options: { type: "object" },
        operations: {
          type: "object",
          additionalProperties: false,
          properties: { include: NAME_LIST, exclude: NAME_LIST },
        },
        artefacts: {
          type: "object",
          propertyNames: { pattern: ARTEFACT_ID_PATTERN },
          properties: {
            [BOOT_CHECK_ARTEFACT]: {
              oneOf: [
                { type: "boolean" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    frameworkRoutes: { type: "boolean" },
                    hooks: { enum: [...HOOK_BOOT_CHECK_LEVELS] },
                  },
                },
              ],
            },
          },
          additionalProperties: { type: "boolean" },
        },
        allowUntested: {
          type: "array",
          items: { type: "string", pattern: ALLOW_UNTESTED_PATTERN },
          uniqueItems: true,
        },
        frameworkRoutes: { type: "array", items: { $ref: "#/$defs/frameworkRoute" } },
        frameworkDocs: { enum: [...FRAMEWORK_DOCS_SWITCHES] },
      },
      oneOf: [
        { required: ["api"], not: { required: ["apis"] } },
        { required: ["apis"], not: { required: ["api"] } },
      ],
    },
  },
};
