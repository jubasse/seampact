import { type IrInstanceNode, walkIrInstance } from "./instance-walk.js";

// The cross-member rules of the IR that the ADR 0003 subset cannot state (no conditional keyword), by stable
// id. README.md lists them; p2-finalize runs `checkIrInvariants` after the strict form, and native readers'
// tests reuse it. A rule reads only known values: an unknown tag or open-enum value is the reader's to name.
export type IrInvariantId =
  | "ir.name.status"
  | "ir.meta.source"
  | "ir.value-source.members"
  | "ir.value-source.place"
  | "ir.header.members"
  | "ir.cache.directives"
  | "ir.csrf.cookie"
  | "ir.field-wire.members"
  | "ir.identity.kind"
  | "ir.property.nullable"
  | "ir.scalar.type";

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

const NAMED_SOURCES = ["path", "query", "header", "body", "principal", "scope", "holderField"];
const BARE_SOURCES = ["host", "subdomain", "resolver", "address"];
const QUERY_WIRE_KINDS = ["number", "boolean", "list", "text", "object"];
const QUERY_WIRE_MEMBERS = ["style", "explode", "brackets"];

// Returns every invariant violation of an IR document, empty for a sound one. Pure and Ajv-free; it expects a
// document the open form accepts and never throws on one it refuses.
export function checkIrInvariants(ir: unknown): IrInvariantViolation[] {
  const violations: IrInvariantViolation[] = [];
  const fail = (id: IrInvariantId, pointer: string, message: string) =>
    violations.push({ id, pointer, message });
  const objects = new Map<string, string | undefined>(); // pointer to definition, for placement rules
  const nodes: Extract<IrInstanceNode, { kind: "object" }>[] = [];
  walkIrInstance(ir, (node) => {
    if (node.kind !== "object") return;
    objects.set(node.pointer, node.definition);
    nodes.push(node);
  });
  const doc = isRecord(ir) ? ir : {};
  const schemes = isRecord(doc.schemes) ? doc.schemes : {};

  for (const { pointer, definition, value } of nodes) {
    switch (definition) {
      case "Name": {
        if ((value.role === "response") !== has(value, "status"))
          fail(
            "ir.name.status",
            pointer,
            "A name has 'status' if and only if its role is 'response'.",
          );
        break;
      }
      case "MetaMember": {
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
        if (typeof source !== "string") break;
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
        const token = value.semantic === "versionToken";
        if (typeof value.semantic !== "string") break;
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
        if (kind === "file" || kind === "json") {
          if (QUERY_WIRE_MEMBERS.some((member) => has(value, member)))
            fail(
              "ir.field-wire.members",
              pointer,
              `A '${kind}' field has no style, explode or brackets.`,
            );
        } else if (typeof kind === "string" && QUERY_WIRE_KINDS.includes(kind)) {
          if (!QUERY_WIRE_MEMBERS.every((member) => has(value, member)))
            fail(
              "ir.field-wire.members",
              pointer,
              `A '${kind}' field has style, explode and brackets.`,
            );
        }
        break;
      }
      case "Identity": {
        const kinds = ["credential", "signed"];
        const schemesKind = isRecord(value.schemes) ? value.schemes.kind : undefined;
        if (
          kinds.includes(String(value.kind)) &&
          kinds.includes(String(schemesKind)) &&
          value.kind !== schemesKind
        )
          fail("ir.identity.kind", pointer, "An identity's 'schemes' carry the identity's kind.");
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
      case "Scalar": {
        if (isRecord(value.type) && has(value.type, "scalar"))
          fail("ir.scalar.type", pointer, "A named format's own type names no 'scalar'.");
        break;
      }
    }
  }
  return violations;
}
