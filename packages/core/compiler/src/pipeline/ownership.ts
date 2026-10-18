import { type DerivationRow, derivationRowOf } from "../derivations/table.js";
import type { HalfName } from "./halves.js";

// The field-ownership table of ADR 0006 section 3, split into the six halves (ADR 0006 section 2: ownership moves
// between passes only by an ADR change; the halves split within a pass). Each row is a draft field at the level
// where halves meet, with one of three modes:
// - `owned`: one owner writes the field and everything below it;
// - `default`: written only where still absent, by the halves of `order` in run order (each row's comment says
//   who writes it and when, ADR 0006 section 3);
// - `elements`: a list several halves append to; each element, and everything below it but its own sub-rows, is
//   owned by `declared` when it has no `derivedFrom`, else by the `wire` owner of its derivation in the
//   derivation table (`derivations/table.ts`): declared parameters and responses and the `relay.route`,
//   `batch.read`, `response.format` and `budget.timeout` elements to tree.nodes, `rule.proof` elements to
//   access.rights, other derived wire elements to derive.wire. `derived` lists the halves whose derivations add
//   elements to the list; a derived element of another half's derivation is refused there. A rule proof read in
//   a header is a derived header parameter; one read in the body is an element of `operations[].input.proofs`,
//   which access.rights owns whole.
// A field above rows (`operations[]`, `operations[].input`) is a container: halves navigate through it, and
// writing it writes each row below it. The finalize members (top level, and each operation's `features`) belong
// to `finalize`, which no half is.
//
// Paths are normalised: `[]` for the items of a list, and a catalogue named by its member (`schemas` covers
// every schema, `operations[].params.query` every query parameter). The test `every member has one owner` walks
// the IR schema and fails on a member with no row; `ownership matches ADR 0006` compares the table, projected on
// passes, with ADR 0006 section 3.

export type DraftOwner = HalfName | "finalize";

export type OwnershipRow =
  | { field: string; mode: "owned"; owner: DraftOwner }
  | { field: string; mode: "default"; order: readonly HalfName[] }
  | { field: string; mode: "elements"; declared: HalfName; derived: readonly HalfName[] };

const owned = <F extends string>(owner: DraftOwner, ...fields: F[]) =>
  fields.map((field) => ({ field, mode: "owned" as const, owner }));
// A list declared by tree.nodes, with the halves whose derivations add to it.
const elements = <F extends string>(field: F, ...derived: HalfName[]) => ({
  field,
  mode: "elements" as const,
  declared: "tree.nodes" as const,
  derived,
});
const op = <M extends string>(member: M): `operations[].${M}` => `operations[].${member}`;
const ops = <M extends string>(...members: M[]): `operations[].${M}`[] => members.map(op);
// Members of an operation's input written by `first`, else by access.rights where still absent.
const inputDefaults = <M extends string>(first: HalfName, ...members: M[]) =>
  members.map((member) => ({
    field: op(`input.${member}` as const),
    mode: "default" as const,
    order: [first, "access.rights"] as const,
  }));

// The members of the api tree.nodes writes (ADR 0004 section 2), every one but `wire`.
const API_MEMBERS = [
  "id",
  "name",
  "version",
  "kind",
  "pathVersion",
  "role",
  "maturity",
  "caller",
  "compat",
  "surfaces",
  "documents",
  "docs",
  "extensions",
  "origin",
] as const;

/** The ownership table, one row per field. */
export const pipelineOwnership = [
  // Finalize computes these from the complete draft (ADR 0004 section 2): `kinds` and `features` from the
  // members present, each operation's `features` as well (ADR 0005), so no half can forget one.
  ...owned("finalize", "irVersion", "irRevision", "kinds", "features", op("features")),
  // Top level.
  ...owned("tree.schemas", "schemas", "scalars", "enums", "extensionKeys"),
  ...owned("tree.nodes", "conventions", "lint", "packs", "formats", "pagings", "services"),
  // The api: tree.nodes writes what it declares, derive.wire its wire conventions.
  ...owned("tree.nodes", ...API_MEMBERS.map((member) => `api.${member}` as const)),
  ...owned("derive.wire", "api.wire"),
  ...owned("access.identity", "schemes", "headers", "identities"),
  ...owned("access.rights", "rights", "rules", "scopes", "buckets"),
  ...owned("derive.errors", "errors", "natures"),
  // Per operation, tree.nodes: the route and the shape it declares (ADR 0006 section 3, tree row).
  ...owned(
    "tree.nodes",
    ...ops(
      "kind",
      "id",
      "name",
      "surface",
      "op",
      "resource",
      "method",
      "path",
      "safe",
      "unknownQuery",
      "input.fields",
      "concurrency.version",
      "concurrency.field",
      "owner",
      "paging.style",
      "paging.maxLimit",
      "paging.defaultLimit",
      "paging.overLimit",
      "paging.token",
      "paging.origin",
      "paging.sortKeys[].key",
      "paging.sortKeys[].origin",
      "degradable",
      "budgetMs",
      "deprecated",
      "relays",
      "upstream",
      "internal",
      "tags",
      "examples",
      "format",
      "docs",
      "extensions",
      "origin",
    ),
  ),
  // Derived elements: tree.nodes' are those a relay route copies (`relay.route`); access.rights adds rule proof
  // headers (`rule.proof`); derive.wire the other derived parameters, responses and response headers.
  elements(op("params.path"), "tree.nodes", "derive.wire"),
  elements(op("params.query"), "tree.nodes", "derive.wire"),
  elements(op("params.header"), "tree.nodes", "access.rights", "derive.wire"),
  elements(op("responses"), "tree.nodes", "derive.wire"),
  elements(op("responses[].headers"), "tree.nodes", "derive.wire"),
  // Stated by tree.nodes, else derived by derive.wire.
  { field: op("maturity"), mode: "default", order: ["tree.nodes", "derive.wire"] },
  // The input a route declares, else the proof-only input access.rights writes for a body proof on a route
  // without `input` (ADR 0002 section 9): media `application/json`, the core empty schema `ApiEmptyBody`,
  // `rawBody`, the origin of the first requirement, in requirement order, that brings a body proof, then
  // `proofs`. On a signed identity's route, `rawBody` is true, as `signed.identity` writes it for a declared
  // input, and access.rights also copies the identity's `unknownKeys` onto it; elsewhere `rawBody` is false.
  ...inputDefaults("tree.nodes", "media", "schema", "origin"),
  // Two writers: access.identity, on every declared input, true on a signed identity's route and false elsewhere
  // (ADR 0006 section 3); access.rights, on the proof-only input it writes, by the same rule.
  ...inputDefaults("access.identity", "rawBody"),
  // Declared by tree.nodes, then access.identity on a signed identity's routes, then access.rights, which copies
  // the identity's onto a proof-only input it writes, then derive.wire from `conventions.input.unknownKeys`.
  {
    field: op("input.schema.unknownKeys"),
    mode: "default",
    order: ["tree.nodes", "access.identity", "access.rights", "derive.wire"],
  },
  // Per operation, access.identity.
  ...owned(
    "access.identity",
    ...ops("access", "callerKinds", "principalRequires", "bindings", "csrf"),
  ),
  // Per operation, access.rights. A sort key's `derivedFrom` comes with its derived right (`sortKey.restricted`);
  // `input.proofs` holds the body fields of rule proofs (`rule.proof`), each with its `derivedFrom`.
  ...owned(
    "access.rights",
    ...ops(
      "scopes",
      "requires",
      "fieldRights",
      "filteredBy",
      "input.proofs",
      "paging.sortKeys[].right",
      "paging.sortKeys[].params",
      "paging.sortKeys[].subject",
      "paging.sortKeys[].derivedFrom",
    ),
  ),
  // Per operation, derive.wire.
  ...owned(
    "derive.wire",
    ...ops("input.bodyLimitBytes", "idempotency", "concurrency.derivedFrom", "cache"),
    op("deadlineHeader"),
  ),
  // Per operation, derive.errors: every element of `errors`, a relay route's copied codes included.
  ...owned("derive.errors", op("errors")),
] as const satisfies readonly OwnershipRow[];

/** A field of the ownership table. */
export type DraftOwnedField = (typeof pipelineOwnership)[number]["field"];

/** The containers above the rows: navigable, and written only through the rows below them. */
export const pipelineContainers = [
  "api",
  "operations",
  "operations[]",
  "operations[].params",
  "operations[].input",
  "operations[].concurrency",
  "operations[].paging",
  "operations[].paging.sortKeys",
  "operations[].paging.sortKeys[]",
] as const;

export type DraftContainerField = (typeof pipelineContainers)[number];

/** A normalised draft-IR path a half declares it reads or writes (ADR 0006 section 2). */
export type DraftField = DraftOwnedField | DraftContainerField;

/** The segments of a normalised path: `operations[].requires` is `operations`, `[]`, `requires`. */
export function draftFieldSegments(field: string): string[] {
  const segments: string[] = [];

  for (const part of field.split(".")) {
    const name = part.endsWith("[]") ? part.slice(0, -2) : part;

    if (name !== "") segments.push(name);

    if (part.endsWith("[]")) segments.push("[]");
  }

  return segments;
}

const ROWS = new Map<string, OwnershipRow>(pipelineOwnership.map((row) => [row.field, row]));

/** The row of a field, if the field is a row. */
export const draftOwnershipRow = (field: string): OwnershipRow | undefined => ROWS.get(field);

/** The owner of an element of an `elements` row: `declared` without `derivedFrom`, else its derivation's. */
export function draftElementOwner(
  row: Extract<OwnershipRow, { mode: "elements" }>,
  element: unknown,
): { owner: HalfName | undefined; derivation?: string; derivationRow?: DerivationRow } {
  if (typeof element !== "object" || element === null || !Object.hasOwn(element, "derivedFrom"))
    return { owner: row.declared };
  const derivedFrom: unknown = Reflect.get(element, "derivedFrom");
  const derivation =
    typeof derivedFrom === "object" && derivedFrom !== null
      ? Reflect.get(derivedFrom, "derivation")
      : undefined;

  if (typeof derivation !== "string") return { owner: undefined };
  const derivationRow = derivationRowOf(derivation);

  return {
    owner: derivationRow?.wire ?? undefined,
    derivation,
    ...(derivationRow && { derivationRow }),
  };
}

/** The owner of a row, in words, for diagnostics and error messages. */
export function draftOwnerText(row: OwnershipRow | undefined): string {
  if (row === undefined) return "no owner";

  switch (row.mode) {
    case "owned":
      return row.owner;
    case "default":
      return `the first of ${row.order.join(", ")} to write it (a default, written only where absent)`;
    case "elements":
      return `${row.declared} for a declared element, the wire owner of its derivation for a derived one (${row.derived.join(", ")})`;
  }
}
