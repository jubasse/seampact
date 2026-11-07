import { type ContractIR, isKnownVariant, type Operation, type TypeUse } from "@seampact/spec/ir";
import { type ChangeReach, NO_POSITION } from "./sink.js";

// Which operations reach each named schema, enum, scalar and declaration, and from which position: input is the
// path, query and header params, the request body and what admits a request (identity, schemes, rights, rules,
// scopes, buckets and their schemas), output the success responses, their headers, the error codes and params and
// the wire format. A catalogue entry's change is classified once per position, for the operations reaching it
// there in both IRs.

type ReachPosition = "input" | "output";

interface ReachEntry {
  readonly operation: string;
  readonly position: ReachPosition;
  /** The input use reaching the member refuses unknown keys (the default of an input use). */
  readonly refusesUnknownKeys: boolean;
}

/**
 * Entries by reach key (`schemas/<id>`, `enums/<id>`, `scalars/<id>`, `<declaration catalogue>/<id>`,
 * `wire/int64`, `wire/outputEnums`).
 */
export type ReachIndex = ReadonlyMap<string, ReadonlyMap<string, ReachEntry>>;

const UNKNOWN_KEYS_REFUSE = "refuse";

export function schemaReachKey(id: string): string {
  return `schemas/${id}`;
}

export function enumReachKey(id: string): string {
  return `enums/${id}`;
}

export function scalarReachKey(id: string): string {
  return `scalars/${id}`;
}

/** The reach key of an entry of a declaration catalogue (`errors`, `identities`, `formats`...). */
export function declarationReachKey(catalogue: string, id: string): string {
  return `${catalogue}/${id}`;
}

export const INT64_REACH_KEY = "wire/int64";
export const OUTPUT_ENUMS_REACH_KEY = "wire/outputEnums";

export function buildReachIndex(ir: ContractIR): ReachIndex {
  const index = new Map<string, Map<string, ReachEntry>>();

  for (const operation of ir.operations) visitOperation(ir, operation, index);

  return index;
}

/**
 * The reaches of `key` common to both IRs, grouped by position and unknown-key policy. A member reached by no
 * operation in either IR is reached from no position; one reached on one side only gives no reach: the use
 * that changed is classified where it changed.
 */
export function commonReaches(
  before: ReachIndex,
  after: ReachIndex,
  key: string,
): readonly ChangeReach[] {
  const beforeEntries = before.get(key);
  const afterEntries = after.get(key);

  if (beforeEntries === undefined && afterEntries === undefined) return NO_POSITION;

  const beforePlaces = new Set([...(beforeEntries?.values() ?? [])].map(placeOf));
  const groups = new Map<
    string,
    { position: ReachPosition; refuses: boolean; operations: string[] }
  >();

  for (const entry of afterEntries?.values() ?? []) {
    if (!beforePlaces.has(placeOf(entry))) continue;

    const groupKey = `${entry.position}/${entry.refusesUnknownKeys}`;
    const group = groups.get(groupKey) ?? {
      position: entry.position,
      refuses: entry.refusesUnknownKeys,
      operations: [],
    };

    group.operations.push(entry.operation);
    groups.set(groupKey, group);
  }

  return [...groups.keys()].sort().map((groupKey) => {
    const group = groups.get(groupKey);

    if (group === undefined) throw new Error(`reach group ${groupKey} vanished`);

    return {
      position: group.position,
      operations: group.operations,
      ...(group.refuses ? { facts: ["afterRefusesUnknownKeys" as const] } : {}),
    };
  });
}

function placeOf(entry: ReachEntry): string {
  return `${entry.operation}\u0000${entry.position}`;
}

function visitOperation(
  ir: ContractIR,
  operation: Operation,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  const input: ReachEntry = {
    operation: operation.id,
    position: "input",
    refusesUnknownKeys: true,
  };
  const output: ReachEntry = {
    operation: operation.id,
    position: "output",
    refusesUnknownKeys: false,
  };
  const visit = (use: TypeUse, entry: ReachEntry) => visitTypeUse(ir, use, entry, index);

  for (const param of [
    ...operation.params.path,
    ...operation.params.query,
    ...operation.params.header,
  ]) {
    visit(param.type, input);
  }

  if (operation.input !== undefined) {
    visit(operation.input.schema, input);

    for (const proof of operation.input.proofs ?? []) visit(proof.schema, input);
  }

  for (const response of operation.responses) {
    if (response.body !== undefined) visit(response.body, output);

    for (const header of response.headers) visit(header.type, output);
  }

  for (const error of operation.errors) {
    const declaration = ir.errors[error.code];

    addReach(index, declarationReachKey("errors", error.code), output);

    if (declaration?.natureName !== undefined)
      addReach(index, declarationReachKey("natures", declaration.natureName), output);

    if (declaration?.params !== undefined) visitSchema(ir, declaration.params, output, index);
  }

  visitOperationDeclarations(ir, operation, input, output, index);
}

function visitOperationDeclarations(
  ir: ContractIR,
  operation: Operation,
  input: ReachEntry,
  output: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  addReach(index, declarationReachKey("formats", operation.format), output);

  if (operation.paging?.style !== undefined) {
    addReach(index, declarationReachKey("pagings", operation.paging.style), input);
    addReach(index, declarationReachKey("pagings", operation.paging.style), output);
  }

  if (isKnownVariant("Access", operation.access) && operation.access.kind !== "public") {
    visitIdentity(ir, operation.access.identity, input, index);

    for (const scheme of operation.access.schemes) visitScheme(ir, scheme, input, index);
  }

  for (const requirement of operation.requires) {
    if (!isKnownVariant("Requirement", requirement)) continue;

    if (requirement.kind === "right") {
      visitRight(ir, requirement.right, input, index);
      continue;
    }

    visitRule(ir, requirement.rule, input, index);

    if (requirement.bucket !== undefined)
      addReach(index, declarationReachKey("buckets", requirement.bucket), input);
  }

  for (const fieldRight of operation.fieldRights)
    visitRight(ir, fieldRight.right, fieldRight.direction === "output" ? output : input, index);

  for (const sortKey of operation.paging?.sortKeys ?? [])
    if (sortKey.right !== undefined) visitRight(ir, sortKey.right, input, index);

  if (operation.filteredBy !== undefined) visitRight(ir, operation.filteredBy, output, index);

  for (const scope of operation.scopes) visitScope(ir, scope.scope, input, index);
}

function visitIdentity(
  ir: ContractIR,
  id: string,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  const identity = ir.identities[id];

  if (!addReach(index, declarationReachKey("identities", id), entry)) return;

  if (identity === undefined || !isKnownVariant("Identity", identity)) return;

  const schemes =
    identity.kind === "signed"
      ? [identity.signed]
      : [...identity.schemes.read, ...identity.schemes.write, ...identity.schemes.optionalRead];

  for (const scheme of schemes) visitScheme(ir, scheme, entry, index);

  if (isKnownVariant("Principal", identity.principal)) {
    const principalSchemas =
      identity.principal.kind === "schema"
        ? [identity.principal.schema]
        : Object.values(identity.principal.variants);

    for (const schema of principalSchemas) visitSchema(ir, schema, entry, index);
  }

  for (const header of identity.headers) {
    const declaration = ir.headers[header.header];

    addReach(index, declarationReachKey("headers", header.header), entry);

    if (header.schema !== undefined) visitTypeUse(ir, header.schema, entry, index);

    if (declaration?.schema !== undefined) visitTypeUse(ir, declaration.schema, entry, index);
  }
}

function visitScheme(
  ir: ContractIR,
  id: string,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  if (!addReach(index, declarationReachKey("schemes", id), entry)) return;

  const scheme = ir.schemes[id];

  if (scheme !== undefined && isKnownVariant("Scheme", scheme) && scheme.kind === "cookie") {
    if (scheme.csrf !== undefined) visitScheme(ir, scheme.csrf, entry, index);
  }
}

function visitRight(
  ir: ContractIR,
  id: string,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  if (!addReach(index, declarationReachKey("rights", id), entry)) return;

  const right = ir.rights[id];

  if (right === undefined) return;

  if (right.params !== undefined) visitSchema(ir, right.params, entry, index);

  if (!isKnownVariant("RightSubject", right.subject)) return;

  if (right.subject.kind === "resource") visitTypeUse(ir, right.subject.idSchema, entry, index);

  if (right.subject.kind === "scope") visitScope(ir, right.subject.scope, entry, index);
}

function visitRule(
  ir: ContractIR,
  id: string,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  if (!addReach(index, declarationReachKey("rules", id), entry)) return;

  const rule = ir.rules[id];

  if (rule?.params !== undefined) visitSchema(ir, rule.params, entry, index);

  if (rule?.proof !== undefined) visitTypeUse(ir, rule.proof.schema, entry, index);
}

function visitScope(
  ir: ContractIR,
  id: string,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  if (!addReach(index, declarationReachKey("scopes", id), entry)) return;

  const scope = ir.scopes[id];

  if (scope === undefined) return;

  visitTypeUse(ir, scope.idSchema, entry, index);

  if (scope.within !== undefined) visitScope(ir, scope.within, entry, index);
}

function visitTypeUse(
  ir: ContractIR,
  use: TypeUse,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  if (!isKnownVariant("TypeUse", use)) return;

  switch (use.kind) {
    case "ref": {
      const policy = use.unknownKeys?.policy;
      const refuses =
        policy === undefined ? entry.refusesUnknownKeys : policy === UNKNOWN_KEYS_REFUSE;

      visitSchema(
        ir,
        use.schema,
        { ...entry, refusesUnknownKeys: entry.position === "input" && refuses },
        index,
      );

      return;
    }

    case "enum":
      if (use.narrowedTo === undefined) addReach(index, enumReachKey(use.enum), entry);

      if (entry.position === "output") addReach(index, OUTPUT_ENUMS_REACH_KEY, entry);

      return;
    case "scalar":
      if (use.scalar !== undefined) addReach(index, scalarReachKey(use.scalar), entry);

      if (use.format === "int64") addReach(index, INT64_REACH_KEY, entry);

      if (use.content !== undefined) visitTypeUse(ir, use.content.schema, entry, index);

      return;
    case "array":
      visitTypeUse(ir, use.items, entry, index);

      return;
    case "file":
    case "opaque":
      return;
  }
}

function visitSchema(
  ir: ContractIR,
  id: string,
  entry: ReachEntry,
  index: Map<string, Map<string, ReachEntry>>,
): void {
  if (!addReach(index, schemaReachKey(id), entry)) return;

  const schema = ir.schemas[id];

  if (schema === undefined || !isKnownVariant("Schema", schema)) return;

  switch (schema.kind) {
    case "object":
      for (const property of schema.properties) visitTypeUse(ir, property.type, entry, index);

      return;
    case "map":
      if (schema.keys !== undefined) visitTypeUse(ir, schema.keys, entry, index);
      visitTypeUse(ir, schema.values, entry, index);

      return;
    case "union":
      for (const variant of schema.variants) visitSchema(ir, variant.schema, entry, index);

      return;
  }
}

// False when the entry was already there, which ends the walk of a recursive schema.
function addReach(
  index: Map<string, Map<string, ReachEntry>>,
  key: string,
  entry: ReachEntry,
): boolean {
  const entries = index.get(key) ?? new Map<string, ReachEntry>();
  const entryKey = `${placeOf(entry)}\u0000${entry.refusesUnknownKeys}`;

  index.set(key, entries);

  if (entries.has(entryKey)) return false;

  entries.set(entryKey, entry);

  return true;
}
