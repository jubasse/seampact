import type { AuthoringFile } from "@seampact/spec/authoring";

// The positions of the authoring schemas that name a declaration (grammar section 3): each one gets the
// workspace's names of its catalogue in the editor schemas. Every other position keeps checking keywords only:
// rule, bucket, scheme, scope, nature, format, upstream, successor, an error family.

/** The catalogues whose names the editor schemas list. */
export type EditorCatalogue =
  | "identities"
  | "rights"
  | "requirements"
  | "enums"
  | "errors"
  | "pagings"
  | "schemas";

/**
 * How the position holds the name: `name`, a string next to a `$ref` to a common name definition; `list`, a
 * `$ref` to a common list of names; `reference`, the schema reference definition, which also takes a file path.
 */
export type NamePositionForm = "name" | "list" | "reference";

export interface NamePosition {
  readonly file: AuthoringFile;
  /** JSON Pointer into the published schema of `file`. */
  readonly pointer: string;
  readonly form: NamePositionForm;
  /** For `name` and `list`: the `$ref` the position holds in the published schema. */
  readonly holds?: string;
  readonly catalogue: EditorCatalogue;
  /** Words the position takes besides the declared names, with what each means. */
  readonly words?: Readonly<Record<string, string>>;
}

const COMMON = "common.schema.json#/$defs/";
const NAME = `${COMMON}name`;
const RIGHT_NAME = `${COMMON}rightName`;
const SCHEMA_NAME = `${COMMON}schemaName`;
const ERROR_CODE = `${COMMON}errorCode`;
const ERROR_CODES = `${COMMON}errorCodes`;

const NO_PAGING = { none: "No paging: the whole list in one response." } as const;

const identity = (file: AuthoringFile, pointer: string): NamePosition => ({
  file,
  pointer,
  form: "name",
  holds: NAME,
  catalogue: "identities",
});

const right = (file: AuthoringFile, pointer: string): NamePosition => ({
  file,
  pointer,
  form: "name",
  holds: RIGHT_NAME,
  catalogue: "rights",
});

const enumName = (file: AuthoringFile, pointer: string): NamePosition => ({
  file,
  pointer,
  form: "name",
  holds: SCHEMA_NAME,
  catalogue: "enums",
});

const errorCode = (file: AuthoringFile, pointer: string): NamePosition => ({
  file,
  pointer,
  form: "name",
  holds: ERROR_CODE,
  catalogue: "errors",
});

const errorCodes = (file: AuthoringFile, pointer: string): NamePosition => ({
  file,
  pointer,
  form: "list",
  holds: ERROR_CODES,
  catalogue: "errors",
});

const NODE_IDENTITIES = ["route", "collection", "single", "scope", "surface", "op", "batchOp"];
const FILTERED_ROUTES = ["route", "op", "batchOp"];
const LISTING_CATALOGUES: readonly AuthoringFile[] = ["identities", "rights", "rules", "scopes"];

export const NAME_POSITIONS: readonly NamePosition[] = [
  identity("api", "/$defs/api/properties/caller/properties/identity"),
  ...NODE_IDENTITIES.map((def) => identity("node", `/$defs/${def}/properties/identity`)),

  right("api", "/$defs/api/properties/caller/properties/right"),
  right("node", "/$defs/requirement/properties/right"),
  right("node", "/$defs/sortable/items/else/then/properties/right"),
  ...FILTERED_ROUTES.map((def) => right("node", `/$defs/${def}/properties/filteredBy`)),
  right("schema", "/$defs/restrictedTo/then"),
  right("schema", "/$defs/restrictedTo/else/then/properties/right"),

  {
    file: "node",
    pointer: "/$defs/requires/items/then",
    form: "name",
    holds: NAME,
    catalogue: "requirements",
  },

  enumName("enums", "/$defs/source/properties/enum"),
  enumName("schema", "/$defs/plain/properties/enum/else/then"),
  enumName("schema", "/$defs/plain/properties/enum/else/else/then/properties/narrow"),

  errorCodes("conventions", "/$defs/conventions/properties/errors/properties/every"),
  ...LISTING_CATALOGUES.map((file) => errorCodes(file, "/$defs/entry/properties/errors")),
  errorCode("identities", "/$defs/headerUse/properties/stale"),
  errorCode("node", "/$defs/examples/additionalProperties/properties/error"),
  errorCode("conventions", "/$defs/roleBinding/then"),
  errorCode("conventions", "/$defs/roleBinding/else/then/properties/code"),
  errorCodes("pack", "/$defs/entry/properties/declareRight/properties/errors"),
  errorCodes("pack", "/$defs/entry/properties/attachErrors"),

  {
    file: "node",
    pointer: "/$defs/paging/then",
    form: "name",
    holds: NAME,
    catalogue: "pagings",
    words: NO_PAGING,
  },
  {
    file: "conventions",
    pointer: "/$defs/conventions/properties/paging/properties/default",
    form: "name",
    holds: NAME,
    catalogue: "pagings",
  },

  { file: "schema", pointer: "/$defs/reference", form: "reference", catalogue: "schemas" },
  {
    file: "rights",
    pointer: "/$defs/subject/properties/resource",
    form: "name",
    holds: SCHEMA_NAME,
    catalogue: "schemas",
  },
];
