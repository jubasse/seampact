import { escapePointer, isSchemaNode } from "./schema-walk.js";
import { IR_SCHEMA_DOCUMENTS, type SchemaNode } from "./schemas.js";

// The known-values annotation of an open enum and the must-act annotation (README.md). Neither validates.
export const KNOWN_VALUES_KEYWORD = "x-seampact-known";
export const MUST_ACT_KEYWORD = "x-seampact-must-act";

// Every definition of the IR schema files by name (names are unique across the files).
const DEFINITIONS = new Map<string, SchemaNode>();

for (const document of IR_SCHEMA_DOCUMENTS) {
  const defs = document.$defs;

  if (!isSchemaNode(defs)) continue;

  for (const [name, def] of Object.entries(defs)) if (isSchemaNode(def)) DEFINITIONS.set(name, def);
}

export const irDefinition = (name: string): SchemaNode | undefined => DEFINITIONS.get(name);
export const irDefinitionNames = (): string[] => [...DEFINITIONS.keys()];

// One node of an IR instance, as the schema reads it: an object of a definition, a tagged union object, the
// value of an open enum, or a string of a named definition (an id, a code, a reason).
export type IrInstanceNode =
  | {
      kind: "object";
      pointer: string;
      definition: string | undefined;
      value: Record<string, unknown>;
    }
  | {
      kind: "union";
      pointer: string;
      definition: string;
      tag: string;
      known: readonly string[];
      mustAct: boolean;
      value: Record<string, unknown>;
    }
  | {
      kind: "openEnum";
      pointer: string;
      definition: string | undefined;
      known: readonly string[];
      mustAct: boolean;
      value: string;
    }
  | {
      kind: "string";
      pointer: string;
      definition: string;
      value: string;
    };

function resolve(node: SchemaNode): { node: SchemaNode; definition: string | undefined } {
  let definition: string | undefined;
  let current = node;

  while (typeof current.$ref === "string") {
    definition = current.$ref.slice(current.$ref.lastIndexOf("/") + 1);
    const next = DEFINITIONS.get(definition);

    if (next === undefined) throw new Error(`no IR schema definition ${definition}`);
    current = next;
  }

  return { node: current, definition };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The tag values of a union's variants, in schema order.
function variantTags(union: SchemaNode, tag: string): { tag: string; variant: SchemaNode }[] {
  return (union.oneOf as SchemaNode[]).map((variant) => {
    const properties = resolve(variant).node.properties as Record<string, SchemaNode>;

    return { tag: String(properties[tag]?.const), variant };
  });
}

// Visits every IR object, tagged union and open-enum value of `value`, read as `schema` (the ContractIR by
// default). Maps and opaque values are data: their entries are walked, never treated as IR objects. A member
// the schema does not know, or a union with an unknown tag, is not descended into. Never throws on a
// malformed instance: shapes the schema refuses are skipped (the validator reports them).
export function walkIrInstance(
  value: unknown,
  visit: (node: IrInstanceNode) => void,
  schema: SchemaNode = { $ref: "#/$defs/ContractIR" },
  pointer = "",
): void {
  const { node, definition } = resolve(schema);

  if (isSchemaNode(node.discriminator) && Array.isArray(node.oneOf)) {
    if (!isRecord(value)) return;
    const tag = String(node.discriminator.propertyName);
    const variants = variantTags(node, tag);

    visit({
      kind: "union",
      pointer,
      definition: definition ?? "?",
      tag,
      known: variants.map((variant) => variant.tag),
      mustAct: node[MUST_ACT_KEYWORD] === true,
      value,
    });
    const match = variants.find((variant) => variant.tag === value[tag]);

    if (match !== undefined) walkIrInstance(value, visit, match.variant, pointer);

    return;
  }

  if (isSchemaNode(node.properties)) {
    if (!isRecord(value)) return;
    visit({ kind: "object", pointer, definition, value });
    const properties = node.properties as Record<string, SchemaNode>;

    for (const [member, child] of Object.entries(value)) {
      const memberSchema = Object.hasOwn(properties, member) ? properties[member] : undefined;

      if (memberSchema !== undefined)
        walkIrInstance(child, visit, memberSchema, `${pointer}/${escapePointer(member)}`);
    }

    return;
  }

  if (isSchemaNode(node.additionalProperties)) {
    if (!isRecord(value)) return;

    for (const [key, child] of Object.entries(value)) {
      walkIrInstance(child, visit, node.additionalProperties, `${pointer}/${escapePointer(key)}`);
    }

    return;
  }

  if (node.type === "array" && isSchemaNode(node.items)) {
    if (!Array.isArray(value)) return;

    for (const [index, item] of value.entries()) {
      walkIrInstance(item, visit, node.items, `${pointer}/${index}`);
    }

    return;
  }

  const known = node[KNOWN_VALUES_KEYWORD];

  if (Array.isArray(known) && typeof value === "string") {
    visit({
      kind: "openEnum",
      pointer,
      definition,
      known: known as string[],
      mustAct: node[MUST_ACT_KEYWORD] === true,
      value,
    });
  } else if (definition !== undefined && node.type === "string" && typeof value === "string") {
    visit({ kind: "string", pointer, definition, value });
  }
}

// A tag outside a union's known variants (ADR 0005 section 3).
export interface IrUnknownKind {
  pointer: string; // the union object
  tag: string; // its tag member: `kind`, or `in`, `verify`, `policy`
  value: string;
  // A must-act union (README.md): the unknown tag makes the IR invalid for every reader.
  mustAct: boolean;
}

// A value outside an open enum's known values (ADR 0005 section 3).
export interface IrUnknownValue {
  pointer: string;
  value: string;
  known: readonly string[];
  mustAct: boolean;
}

export interface IrUnknowns {
  kinds: IrUnknownKind[];
  values: IrUnknownValue[];
}

// Hands the node's unknown union tag or unknown open-enum value, if it is one, to the matching callback.
// The one reading of "unknown" shared by `listIrUnknowns` and the closed-declaration guard.
export function visitIrUnknown(
  node: IrInstanceNode,
  onKind: (unknown: IrUnknownKind) => void,
  onValue: (unknown: IrUnknownValue) => void,
): void {
  if (node.kind === "union") {
    const value = node.value[node.tag];

    if (typeof value === "string" && !node.known.includes(value))
      onKind({ pointer: node.pointer, tag: node.tag, value, mustAct: node.mustAct });
  } else if (node.kind === "openEnum" && !node.known.includes(node.value)) {
    onValue({ pointer: node.pointer, value: node.value, known: node.known, mustAct: node.mustAct });
  }
}

// Lists every unknown union tag and every unknown open-enum value of an IR document, with its pointer and
// whether it is must-act. Ajv-free: a reader of an IR it did not validate itself calls it before acting.
export function listIrUnknowns(ir: unknown): IrUnknowns {
  const unknowns: IrUnknowns = { kinds: [], values: [] };

  walkIrInstance(ir, (node) =>
    visitIrUnknown(
      node,
      (unknown) => unknowns.kinds.push(unknown),
      (unknown) => unknowns.values.push(unknown),
    ),
  );

  return unknowns;
}
