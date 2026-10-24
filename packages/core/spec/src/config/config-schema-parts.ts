import type { JsonSchema } from "../authoring/schemas.js";

// The schema fragments the app config and the root config share, so that both files take the same forms.

// The name of a target entry, a source, an api, a document or a merged document, as a config writes it.
export const ENTRY_ID_PATTERN = "^[A-Za-z][A-Za-z0-9_-]*$";

export const NON_EMPTY_STRING: JsonSchema = { type: "string", minLength: 1 };

export const NAME_LIST: JsonSchema = { type: "array", items: NON_EMPTY_STRING, uniqueItems: true };

const SOURCE_KEYS = ["path", "package", "version", "release", "git", "maven", "integrity"] as const;

// One source form, with no key of another: `path`, or `package` with `version`, `release`, `git` or `maven` with an
// optional `integrity`.
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

// A Maven artefact's `groupId:artifactId:version`, the coordinate a JVM build resolves through its repositories.
const MAVEN_COORDINATE_PATTERN = "^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+$";

// One contract source: a workspace directory or one of the bundle forms (ADR 0011 "The app config"); the `maven`
// form is read by the JVM plugins only (ADR 0010 "The contract bundle as a Maven artefact").
export const SOURCE_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: NON_EMPTY_STRING,
    package: {
      type: "string",
      pattern: NPM_PACKAGE_NAME_PATTERN,
      maxLength: NPM_PACKAGE_NAME_LENGTH_MAX,
    },
    version: NON_EMPTY_STRING,
    release: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: { url: NON_EMPTY_STRING },
    },
    git: {
      type: "object",
      additionalProperties: false,
      required: ["url", "tag"],
      properties: { url: NON_EMPTY_STRING, tag: NON_EMPTY_STRING, directory: NON_EMPTY_STRING },
    },
    maven: { type: "string", pattern: MAVEN_COORDINATE_PATTERN },
    integrity: { type: "string", pattern: "^sha256-" },
  },
  oneOf: [
    sourceForm(["path"], ["path"]),
    sourceForm(["package", "version"], ["package", "version", "integrity"]),
    sourceForm(["release"], ["release", "integrity"]),
    sourceForm(["git"], ["git", "integrity"]),
    sourceForm(["maven"], ["maven", "integrity"]),
  ],
};

// `sources`, by name; each value refers to the file's `#/$defs/source`.
export const SOURCES_SCHEMA: JsonSchema = {
  type: "object",
  propertyNames: { pattern: ENTRY_ID_PATTERN },
  additionalProperties: { $ref: "#/$defs/source" },
};
