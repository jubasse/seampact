import { JSON_SCHEMA_DIALECT, type JsonSchema } from "../authoring/schemas.js";

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
  diff?: DiffConfig;
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
export type BundleSource = PackageBundleSource | ReleaseBundleSource | GitBundleSource;

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

const SOURCE_KEYS = ["path", "package", "version", "release", "git", "integrity"] as const;

// One source form, with no key of another: `path`, or `package` with `version`, `release` or `git` with an optional
// `integrity`.
function sourceForm(required: readonly string[], allowed: readonly string[]): JsonSchema {
  const others = SOURCE_KEYS.filter((key) => !allowed.includes(key));

  return {
    required: [...required],
    not: { anyOf: others.map((key) => ({ required: [key] })) },
  };
}

// An npm package name, scoped or not (npm's rules for new packages): a source's package is resolved under
// `node_modules`, so a path such as `../x` is refused here rather than found outside it.
const NPM_PACKAGE_NAME_PATTERN = "^(?:@[a-z0-9~-][a-z0-9._~-]*/)?[a-z0-9~-][a-z0-9._~-]*$";
const NPM_PACKAGE_NAME_LENGTH_MAX = 214;

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
    allowLocal: { type: "boolean" },
    outDir: nonEmptyString,
    sources: {
      type: "object",
      propertyNames: { pattern: ENTRY_ID_PATTERN },
      additionalProperties: { $ref: "#/$defs/source" },
    },
    targets: { type: "array", items: { $ref: "#/$defs/targetEntry" } },
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
    source: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: nonEmptyString,
        package: {
          type: "string",
          pattern: NPM_PACKAGE_NAME_PATTERN,
          maxLength: NPM_PACKAGE_NAME_LENGTH_MAX,
        },
        version: nonEmptyString,
        release: {
          type: "object",
          additionalProperties: false,
          required: ["url"],
          properties: { url: nonEmptyString },
        },
        git: {
          type: "object",
          additionalProperties: false,
          required: ["url", "tag"],
          properties: { url: nonEmptyString, tag: nonEmptyString, directory: nonEmptyString },
        },
        integrity: { type: "string", pattern: "^sha256-" },
      },
      oneOf: [
        sourceForm(["path"], ["path"]),
        sourceForm(["package", "version"], ["package", "version", "integrity"]),
        sourceForm(["release"], ["release", "integrity"]),
        sourceForm(["git"], ["git", "integrity"]),
      ],
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
