// The titles that mark a definition whose failures the validate stage reports by their own rule
// (packages/core/compiler/src/validate/diagnostics.ts). The grammar writes them through this table, and
// the validate stage maps every one of them, so a renamed or added marker is a type error there.
// Titles in `EDITOR_TITLES` are for editors only; markers.test.ts checks that the generated schemas
// carry no other title.

export const MARKERS = {
  // A refused JSON Schema keyword, or a refused form of a kept one (ADR 0003 section 1).
  refused: "refused",
  refusedForm: "refused form",
  // A key another key excludes; the description says which.
  conflict: "conflict",
  // A reserved key or prefix (`x-seampact-`, `seampact`).
  reserved: "reserved",
  // A reason, and the mappings whose missing key is a missing reason (A40).
  reason: "reason",
  reasonedPolicy: "reasoned policy",
  access: "access",
  csrfExemption: "csrf exemption",
  idempotencyExemption: "idempotency exemption",
  queryException: "query exception",
  unknownKeysException: "unknown keys exception",
  // A node that states no kind (ADR 0002 section 6).
  nodeMarker: "node marker",
  // A derive entry without an effect (ADR 0002 section 2).
  deriveEntry: "derive entry",
  // A mapping that needs one key of several; the description lists them.
  choice: "choice",
  // A value of neither accepted type (a string or a mapping); the description names both.
  alternatives: "alternatives",
  // A map of named tree nodes, the one mapping that refuses `$include` (ADR 0002 section 2).
  routes: "routes",
  // Name positions (ADR 0002 section 4): a pattern failure is `invalid-name`.
  name: "name",
  schemaName: "schema name",
  scalarName: "scalar name",
  rightName: "right name",
  errorCode: "error code",
  headerName: "header name",
  ruleId: "rule id",
  schemaReference: "schema reference",
} as const;

export type Marker = (typeof MARKERS)[keyof typeof MARKERS];

// Titles shown by editors (hover, completion) that no rule of the validate stage reads; a file's
// root title ("seampact api file") is not listed.
export const EDITOR_TITLES: readonly string[] = [
  "date",
  "duration",
  "meta fill",
  "node",
  "pack reference",
  "path",
  "schema",
  "scheme",
  "scheme kind",
  "size",
  "template",
  "unknown keys policy",
  "unknown query policy",
  "value source",
];

// Names no map of the grammar admits as a key, and no right name takes: a key that reaches the
// prototype chain of a JavaScript reader (the loader refuses them as keys too,
// `seampact/load/reserved-key`). Refused through `not: { enum }`, which every JSON Schema
// implementation reads alike (a pattern lookahead is not portable to RE2-based validators).
export const RESERVED_NAMES = ["__proto__", "constructor", "prototype"] as const;

// The title of a data position (ADR 0002 section 2): a payload, an example, a default, where the
// grammar expects any value. The loader reads it: there, null is written `null`, a mapping holding
// only `$file` is replaced, and no scalar type is checked (P6). The positions are marked, never
// inferred: an extension value or a node fragment's placeholder is not data. No rule of the
// validate stage reads it.
export const DATA = "data";

const MARKER_SET: ReadonlySet<string> = new Set(Object.values(MARKERS));

export function isMarker(title: unknown): title is Marker {
  return typeof title === "string" && MARKER_SET.has(title);
}
