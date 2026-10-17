import {
  type IrInstanceNode,
  irDefinition,
  KNOWN_VALUES_KEYWORD,
  walkIrInstance,
} from "./instance-walk.js";
import type { SchemaNode } from "./schemas.js";

// The cross-member rules of the IR that the ADR 0003 subset cannot state (no conditional keyword), by stable
// id. README.md lists them; p2-finalize runs `checkIrInvariants` after the strict form, and native readers'
// tests reuse it. A rule decided by an open-enum value applies to known values only (the known list read from
// the schema's `x-seampact-known`): an unknown tag or value is the reader's to name.
export type IrInvariantId =
  | "ir.name.status"
  | "ir.meta.source"
  | "ir.value-source.members"
  | "ir.value-source.place"
  | "ir.header.members"
  | "ir.cache.directives"
  | "ir.csrf.cookie"
  | "ir.field-wire.members"
  | "ir.property.nullable"
  | "ir.scalar.type"
  | "ir.id.scalar"
  | "ir.ref.resolves"
  | "ir.origin.core"
  | "ir.input-proof.wire"
  | "ir.input-proof.name"
  | "ir.input-proof.input";

export interface IrInvariantViolation {
  id: IrInvariantId;
  pointer: string; // the object that breaks the rule
  message: string;
}

type Json = Record<string, unknown>;

const has = (value: Json, member: string): boolean =>
  Object.hasOwn(value, member) && value[member] !== undefined;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const parentOf = (pointer: string): string => pointer.slice(0, pointer.lastIndexOf("/"));
const unescapeSegment = (segment: string): string =>
  segment.replaceAll("~1", "/").replaceAll("~0", "~");

// The hand-written partitions of the values that decide a struct's members, listed in `IR_PARTITIONS` below. Each
// must be a disjoint union of the schema's known list: invariants.test.ts asserts it, so a new known value fails
// there until its invariant decides it (CHANGE-TEMPLATE.md).
const NAMED_SOURCES = ["path", "query", "header", "body", "principal", "scope", "holderField"];
const BARE_SOURCES = ["host", "subdomain", "resolver", "address"];
const QUERY_WIRE_KINDS = ["number", "boolean", "list", "text", "object"];
const PLAIN_WIRE_KINDS = ["file", "json"];
const QUERY_WIRE_MEMBERS = ["style", "explode", "brackets"];
const ID_TYPE_KINDS = ["scalar", "enum"]; // an id is a scalar or an enum use
const PROOF_REFUSED_KINDS = ["opaque", "file"]; // a proof is anything else
const OTHER_TYPE_KINDS = ["ref", "array"]; // neither an id nor a refused proof
const KNOWN_TYPE_USE_KINDS = [...ID_TYPE_KINDS, ...PROOF_REFUSED_KINDS, ...OTHER_TYPE_KINDS];
// The known schema kinds, object and not: a body proof is a property beside the input's own, so its input is
// an object schema.
const OBJECT_SCHEMA_KINDS = ["object"];
const NON_OBJECT_SCHEMA_KINDS = ["map", "union"];
const KNOWN_SCHEMA_KINDS = [...OBJECT_SCHEMA_KINDS, ...NON_OBJECT_SCHEMA_KINDS];
// The input media whose body is a list of fields, each with a wire form (`fields`, a proof's `wire`), and the rest.
const FIELD_MEDIA = ["application/x-www-form-urlencoded", "multipart/form-data"];
const DOCUMENT_MEDIA = ["application/json"];
// The catalogues of the declarations the compiler supplies (origin layer `core`, ADR 0004 sections 6 and 13).
const CORE_CATALOGUES = ["formats", "errors", "schemas"];

export const IR_PARTITIONS = {
  "ValueSource.in": [NAMED_SOURCES, BARE_SOURCES],
  "FieldWire.kind": [QUERY_WIRE_KINDS, PLAIN_WIRE_KINDS],
  "TypeUse.kind": [ID_TYPE_KINDS, PROOF_REFUSED_KINDS, OTHER_TYPE_KINDS],
  "OperationInput.media": [FIELD_MEDIA, DOCUMENT_MEDIA],
  "Schema.kind": [OBJECT_SCHEMA_KINDS, NON_OBJECT_SCHEMA_KINDS],
} as const satisfies Record<string, readonly (readonly string[])[]>;

// The known values of the open enum that `definition.member` references, read from the schema files.
function knownValues(definition: string, member: string): readonly string[] {
  const properties = irDefinition(definition)?.properties as Record<string, SchemaNode> | undefined;
  let node =
    properties !== undefined && Object.hasOwn(properties, member) ? properties[member] : undefined;

  while (typeof node?.$ref === "string")
    node = irDefinition(node.$ref.slice(node.$ref.lastIndexOf("/") + 1));
  const known = node?.[KNOWN_VALUES_KEYWORD];

  if (!Array.isArray(known)) throw new Error(`${definition}.${member} is not an open enum`);

  return known as string[];
}

const isKnown = (definition: string, member: string, value: unknown): boolean =>
  typeof value === "string" && knownValues(definition, member).includes(value);

// The catalogues an id names, by the id definition that keys them: every map of the top level and of the api
// whose keys are a `$ref` to an id definition (`schemes` keyed by `SchemeId`, `surfaces` by `SurfaceId`).
const CATALOGUES = new Map<string, { owner: "ContractIR" | "Api"; member: string }>();

for (const owner of ["ContractIR", "Api"] as const) {
  const properties = irDefinition(owner)?.properties as Record<string, SchemaNode> | undefined;

  for (const [member, schema] of Object.entries(properties ?? {})) {
    const keys = schema.propertyNames as SchemaNode | undefined;

    if (typeof keys?.$ref === "string")
      CATALOGUES.set(keys.$ref.slice(keys.$ref.lastIndexOf("/") + 1), { owner, member });
  }
}

type Fail = (id: IrInvariantId, pointer: string, message: string) => void;

const proofsOf = (input: Json): unknown[] => (Array.isArray(input.proofs) ? input.proofs : []);

// The schema entry a `ref` use names, if the document has it.
function refTargetOf(use: Json, schemaEntries: Json): unknown {
  if (use.kind !== "ref" || typeof use.schema !== "string") return undefined;

  return Object.hasOwn(schemaEntries, use.schema) ? schemaEntries[use.schema] : undefined;
}

// The input of a body proof is a `ref` use of an object schema (`ApiEmptyBody` for a proof-only input). An
// unknown use or schema kind is the reader's to name, and a missing schema is ir.ref.resolves'.
function checkProofInput(input: Json, pointer: string, schemaEntries: Json, fail: Fail): void {
  if (proofsOf(input).length === 0) return;
  const use = isRecord(input.schema) ? input.schema : {};
  const message = "An input with body proofs is a 'ref' use of an object schema";

  if (use.kind !== "ref") {
    if (KNOWN_TYPE_USE_KINDS.includes(String(use.kind)))
      fail("ir.input-proof.input", `${pointer}/schema`, `${message}, not a '${use.kind}' use.`);

    return;
  }

  const target = refTargetOf(use, schemaEntries);

  if (!isRecord(target)) return;
  const kind = String(target.kind);

  if (KNOWN_SCHEMA_KINDS.includes(kind) && !OBJECT_SCHEMA_KINDS.includes(kind))
    fail(
      "ir.input-proof.input",
      `${pointer}/schema`,
      `${message}: '${String(use.schema)}' is a '${target.kind}' schema.`,
    );
}

// The names a body already carries: the properties of the input's object schema and its form fields.
function bodyNamesOf(input: Json, schemaEntries: Json): Set<unknown> {
  const names = new Set<unknown>();
  const target = refTargetOf(isRecord(input.schema) ? input.schema : {}, schemaEntries);
  const properties = isRecord(target) && Array.isArray(target.properties) ? target.properties : [];
  const fields = Array.isArray(input.fields) ? input.fields : [];

  for (const member of [...properties, ...fields]) if (isRecord(member)) names.add(member.name);

  return names;
}

// A proof is identified by its name: one element per name, and no name the body already carries.
function checkProofNames(input: Json, pointer: string, schemaEntries: Json, fail: Fail): void {
  const taken = bodyNamesOf(input, schemaEntries);
  const seen = new Set<unknown>();

  for (const [i, proof] of proofsOf(input).entries()) {
    if (!isRecord(proof) || typeof proof.name !== "string") continue;

    if (seen.has(proof.name) || taken.has(proof.name))
      fail(
        "ir.input-proof.name",
        `${pointer}/proofs/${i}`,
        `The body proof '${proof.name}' repeats a proof, a property of the input schema or a form field.`,
      );
    seen.add(proof.name);
  }
}

// A body proof is sent as the input's other fields are: with a wire form in a form or multipart body, none in a
// JSON one, and never a file one, since a proof is no file (ir.id.scalar). An unknown media type is the
// reader's to name.
function checkProofWires(input: Json, pointer: string, fail: Fail): void {
  const mediaKnown = isKnown("OperationInput", "media", input.media);
  const fieldMedia = FIELD_MEDIA.includes(String(input.media));

  for (const [i, proof] of proofsOf(input).entries()) {
    if (!isRecord(proof)) continue;

    if (isRecord(proof.wire) && proof.wire.kind === "file")
      fail(
        "ir.input-proof.wire",
        `${pointer}/proofs/${i}`,
        "A body proof's wire kind is not 'file'.",
      );

    if (mediaKnown && has(proof, "wire") !== fieldMedia)
      fail(
        "ir.input-proof.wire",
        `${pointer}/proofs/${i}`,
        `A body proof has 'wire' if and only if the input is form or multipart ('${String(input.media)}').`,
      );
  }
}

// Returns every invariant violation of an IR document, empty for a sound one. Pure and Ajv-free; it expects a
// document the open form accepts and never throws on one it refuses.
export function checkIrInvariants(ir: unknown): IrInvariantViolation[] {
  const violations: IrInvariantViolation[] = [];
  const fail = (id: IrInvariantId, pointer: string, message: string) =>
    violations.push({ id, pointer, message });
  const objects = new Map<string, string | undefined>(); // pointer to definition, for placement rules
  const nodes: Extract<IrInstanceNode, { kind: "object" }>[] = [];
  const ids: Extract<IrInstanceNode, { kind: "string" }>[] = [];

  walkIrInstance(ir, (node) => {
    if (node.kind === "string") ids.push(node);

    if (node.kind !== "object") return;
    objects.set(node.pointer, node.definition);
    nodes.push(node);
  });
  const doc = isRecord(ir) ? ir : {};
  const schemes = isRecord(doc.schemes) ? doc.schemes : {};
  const schemaEntries = isRecord(doc.schemas) ? doc.schemas : {};

  // Every member holding a catalogue id names an existing entry (keys read with Object.hasOwn: a right may be
  // named `__proto__`).
  for (const { pointer, definition, value } of ids) {
    const catalogue = CATALOGUES.get(definition);

    if (catalogue === undefined) continue;
    const owner = catalogue.owner === "ContractIR" ? doc : doc.api;
    const entries = isRecord(owner) ? owner[catalogue.member] : undefined;

    if (isRecord(entries) && !Object.hasOwn(entries, value))
      fail("ir.ref.resolves", pointer, `'${value}' names no entry of '${catalogue.member}'.`);
  }

  for (const { pointer, definition, value } of nodes) {
    switch (definition) {
      case "Origin": {
        // A core origin's pointer starts with its entry of a catalogue (`/errors/api.internal`, or
        // `/errors/api.rate_limited/params` for that code's params schema, ADR 0004 section 6); only that entry is
        // checked. It has no side-table entry, so the entry must be in this document unless the origin names
        // another api (a relay route's copy, read in that api).
        if (value.layer !== "core" || typeof value.pointer !== "string") break;
        const [catalogue = "", id] = value.pointer.split("/").slice(1).map(unescapeSegment);

        if (!CORE_CATALOGUES.includes(catalogue) || id === undefined || id === "") {
          fail(
            "ir.origin.core",
            pointer,
            `A core origin points at an entry of ${CORE_CATALOGUES.join(", ")}: '${value.pointer}' does not.`,
          );
          break;
        }

        const entries = doc[catalogue];

        if (!has(value, "api") && isRecord(entries) && !Object.hasOwn(entries, id))
          fail(
            "ir.origin.core",
            pointer,
            `A core origin names '${id}', which is no entry of '${catalogue}'.`,
          );
        break;
      }

      case "OperationInput": {
        checkProofInput(value, pointer, schemaEntries, fail);
        checkProofNames(value, pointer, schemaEntries, fail);
        checkProofWires(value, pointer, fail);
        break;
      }

      case "Name": {
        if (!isKnown("Name", "role", value.role)) break;

        if ((value.role === "response") !== has(value, "status"))
          fail(
            "ir.name.status",
            pointer,
            "A name has 'status' if and only if its role is 'response'.",
          );
        break;
      }

      case "MetaMember": {
        if (!isKnown("MetaMember", "fill", value.fill)) break;

        if ((value.fill === "source") !== has(value, "source"))
          fail(
            "ir.meta.source",
            pointer,
            "A $meta member has 'source' if and only if 'fill' is 'source'.",
          );
        break;
      }

      case "ValueSource": {
        const source = value.in;

        if (typeof source !== "string" || !isKnown("ValueSource", "in", source)) break;

        if (NAMED_SOURCES.includes(source) && (!has(value, "name") || has(value, "prefixBits")))
          fail(
            "ir.value-source.members",
            pointer,
            `A '${source}' source has 'name' and no 'prefixBits'.`,
          );

        if (BARE_SOURCES.includes(source) && has(value, "name"))
          fail("ir.value-source.members", pointer, `A '${source}' source has no 'name'.`);

        if (source !== "address" && BARE_SOURCES.includes(source) && has(value, "prefixBits"))
          fail("ir.value-source.members", pointer, "Only an 'address' source has 'prefixBits'.");
        const parent = objects.get(parentOf(pointer));

        if (source === "resolver" && parent !== "OperationScope")
          fail("ir.value-source.place", pointer, "A 'resolver' source is a scope source only.");

        if (source === "holderField" && parent !== "FieldRightSubject")
          fail(
            "ir.value-source.place",
            pointer,
            "A 'holderField' source is a field right subject only.",
          );
        break;
      }

      case "HeaderDecl": {
        if (!isKnown("HeaderDecl", "semantic", value.semantic)) break;
        const token = value.semantic === "versionToken";
        const tokenMembers = has(value, "response") && has(value, "request");
        const plainMembers = has(value, "name") && has(value, "in");
        const ok = token
          ? tokenMembers && !has(value, "name") && !has(value, "in")
          : plainMembers && !has(value, "response") && !has(value, "request");

        if (!ok)
          fail(
            "ir.header.members",
            pointer,
            token
              ? "A versionToken header has 'response' and 'request', and no 'name' or 'in'."
              : "A header has 'name' and 'in', and no 'response' or 'request' (versionToken only).",
          );
        break;
      }

      case "Cache": {
        const never = value.family === "never";

        if (never === has(value, "directives"))
          fail(
            "ir.cache.directives",
            pointer,
            "Cache 'directives' are absent if and only if the family is 'never'.",
          );

        if (never && value.noStore !== true)
          fail("ir.cache.directives", pointer, "A 'never' cache family sets 'noStore'.");
        break;
      }

      case "Operation": {
        const access = value.access;

        if (value.safe !== false || !isRecord(access)) break;

        if (access.kind !== "identity" && access.kind !== "optional") break;
        const accepted = Array.isArray(access.schemes) ? access.schemes : [];
        const cookie = accepted.some((id) => {
          const scheme =
            typeof id === "string" && Object.hasOwn(schemes, id) ? schemes[id] : undefined;

          return isRecord(scheme) && scheme.kind === "cookie";
        });

        if (cookie && !has(value, "csrf"))
          fail(
            "ir.csrf.cookie",
            pointer,
            "An unsafe operation reached through a cookie scheme has 'csrf'.",
          );
        break;
      }

      case "FieldWire": {
        const kind = value.kind;

        if (PLAIN_WIRE_KINDS.includes(String(kind))) {
          if (QUERY_WIRE_MEMBERS.some((member) => has(value, member)))
            fail(
              "ir.field-wire.members",
              pointer,
              `A '${kind}' field has no style, explode or brackets.`,
            );
        } else if (QUERY_WIRE_KINDS.includes(String(kind)) && isKnown("FieldWire", "kind", kind)) {
          if (!QUERY_WIRE_MEMBERS.every((member) => has(value, member)))
            fail(
              "ir.field-wire.members",
              pointer,
              `A '${kind}' field has style, explode and brackets.`,
            );
        }

        break;
      }

      case "Property": {
        if (isRecord(value.type) && has(value.type, "nullable"))
          fail(
            "ir.property.nullable",
            pointer,
            "A property's type use has no 'nullable': the property holds it.",
          );
        break;
      }

      case "Scope":
      case "ResourceSubject": {
        const use = value.idSchema;

        if (!isRecord(use) || !KNOWN_TYPE_USE_KINDS.includes(String(use.kind))) break;

        if (!ID_TYPE_KINDS.includes(String(use.kind)) || has(use, "nullable"))
          fail(
            "ir.id.scalar",
            `${pointer}/idSchema`,
            "An id's type use is a 'scalar' or 'enum' use without 'nullable'.",
          );
        break;
      }

      // A rule's proof and the body field it adds to an operation's input (`InputProof`) are typed alike.
      case "RuleProof":
      case "InputProof": {
        const use = value.schema;

        if (isRecord(use) && PROOF_REFUSED_KINDS.includes(String(use.kind)))
          fail(
            "ir.id.scalar",
            `${pointer}/schema`,
            "A rule proof's type use is neither 'opaque' nor 'file'.",
          );
        break;
      }

      case "Scalar": {
        if (isRecord(value.type) && has(value.type, "scalar"))
          fail("ir.scalar.type", pointer, "A named format's own type names no 'scalar'.");
        break;
      }
    }
  }

  return violations;
}
