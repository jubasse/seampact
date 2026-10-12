import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { irDefinition, KNOWN_VALUES_KEYWORD, walkIrInstance } from "./instance-walk.js";
import { checkIrInvariants, IR_PARTITIONS, type IrInvariantId } from "./invariants.js";
import type { SchemaNode } from "./schemas.js";

const sample = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../../schemas/ir/examples/${name}`, import.meta.url), "utf8"));

// The objects of `definition` in `ir`, with their pointers.
function objectsOf(
  ir: unknown,
  definition: string,
): { pointer: string; value: Record<string, unknown> }[] {
  const found: { pointer: string; value: Record<string, unknown> }[] = [];
  walkIrInstance(ir, (node) => {
    if (node.kind === "object" && node.definition === definition) found.push(node);
  });
  return found;
}

// Breaks the first object of `definition` matching `where` and returns the violated ids with their pointers.
function broken(
  definition: string,
  change: (value: Record<string, unknown>) => void,
  where: (value: Record<string, unknown>) => boolean = () => true,
): { id: IrInvariantId; pointer: string }[] {
  const ir = sample("every-member.ir.json");
  const target = objectsOf(ir, definition).find(({ value }) => where(value));
  if (target === undefined) throw new Error(`no ${definition} in the sample`);
  change(target.value);
  return checkIrInvariants(ir).map(({ id, pointer }) => ({ id, pointer }));
}

describe("checkIrInvariants", () => {
  test("accepts the valid samples", () => {
    expect(checkIrInvariants(sample("every-member.ir.json"))).toEqual([]);
    expect(checkIrInvariants(sample("minimal.ir.json"))).toEqual([]);
    expect(checkIrInvariants(null)).toEqual([]);
  });

  test("names each broken rule with its id and the object's pointer", () => {
    const one = (id: IrInvariantId) => [expect.objectContaining({ id })];
    expect(
      broken(
        "Name",
        (name) => {
          name.status = 201;
        },
        (name) => name.role !== "response",
      ),
    ).toEqual(one("ir.name.status"));
    expect(
      broken(
        "Name",
        (name) => {
          delete name.status;
        },
        (name) => name.role === "response",
      ),
    ).toEqual(one("ir.name.status"));
    expect(
      broken(
        "MetaMember",
        (meta) => {
          delete meta.source;
        },
        (meta) => meta.fill === "source",
      ),
    ).toEqual(one("ir.meta.source"));
    expect(
      broken(
        "ValueSource",
        (source) => {
          delete source.name;
        },
        (source) => source.in === "principal",
      ),
    ).toEqual(one("ir.value-source.members"));
    expect(
      broken(
        "ValueSource",
        (source) => {
          source.prefixBits = 8;
        },
        (source) => source.in === "principal",
      ),
    ).toEqual(one("ir.value-source.members"));
    expect(
      broken(
        "ValueSource",
        (source) => {
          source.in = "resolver";
          delete source.name;
        },
        (source) => source.in === "principal",
      ),
    ).toEqual(one("ir.value-source.place"));
    expect(
      broken(
        "HeaderDecl",
        (header) => {
          header.name = "X-Version";
        },
        (header) => header.semantic === "versionToken",
      ),
    ).toEqual(one("ir.header.members"));
    expect(
      broken(
        "HeaderDecl",
        (header) => {
          delete header.in;
        },
        (header) => header.semantic === "deadline",
      ),
    ).toEqual(one("ir.header.members"));
    expect(
      broken(
        "Cache",
        (cache) => {
          delete cache.directives;
        },
        (cache) => cache.family !== "never",
      ),
    ).toEqual(one("ir.cache.directives"));
    expect(
      broken(
        "Cache",
        (cache) => {
          cache.noStore = false;
        },
        (cache) => cache.family === "never",
      ),
    ).toEqual(one("ir.cache.directives"));
    expect(
      broken(
        "Operation",
        (operation) => {
          delete operation.csrf;
        },
        (operation) => operation.safe === false,
      ),
    ).toEqual(one("ir.csrf.cookie"));
    expect(
      broken("FieldWire", (wire) => {
        wire.kind = "file";
        wire.style = "form";
      }),
    ).toEqual(one("ir.field-wire.members"));
    expect(
      broken("Property", (property) => {
        (property.type as Record<string, unknown>).nullable = true;
      }),
    ).toEqual(one("ir.property.nullable"));
    expect(
      broken("Scalar", (scalar) => {
        (scalar.type as Record<string, unknown>).scalar = "money";
      }),
    ).toEqual(one("ir.scalar.type"));
    const use = (value: Record<string, unknown>, member: string) =>
      value[member] as Record<string, unknown>;
    expect(
      broken("Scope", (scope) => {
        use(scope, "idSchema").nullable = true;
      }),
    ).toEqual(one("ir.id.scalar"));
    expect(
      broken("ResourceSubject", (subject) => {
        subject.idSchema = { kind: "ref", schema: "Task" };
      }),
    ).toEqual(one("ir.id.scalar"));
    expect(
      broken("RuleProof", (proof) => {
        proof.schema = { kind: "opaque" };
      }),
    ).toEqual(one("ir.id.scalar"));
    expect(
      broken("RuleProof", (proof) => {
        proof.schema = { kind: "file" };
      }),
    ).toEqual(one("ir.id.scalar"));
    // An unknown use kind is the reader's to name; a proof may be an enum or an array.
    expect(
      broken("Scope", (scope) => {
        scope.idSchema = { kind: "zzLater" };
      }),
    ).toEqual([]);
    expect(
      broken("RuleProof", (proof) => {
        proof.schema = {
          kind: "array",
          items: { kind: "scalar", type: "string", refinements: {} },
        };
      }),
    ).toEqual([]);
  });

  // Each hand-written partition is a disjoint union equal to the schema's known list, so a new known value of
  // a deciding member cannot slip past its invariant unnoticed.
  test("each partition is a disjoint union of the schema's known list", () => {
    const knownOf = (key: string): string[] => {
      const [definition, member] = key.split(".") as [string, string];
      if (definition === "TypeUse")
        return ((irDefinition("TypeUse")?.oneOf ?? []) as SchemaNode[]).map((variant) => {
          const name = String(variant.$ref).slice(String(variant.$ref).lastIndexOf("/") + 1);
          const tag = ((irDefinition(name)?.properties ?? {}) as Record<string, SchemaNode>)[
            member
          ];
          return String(tag?.const);
        });
      const properties = irDefinition(definition)?.properties as Record<string, SchemaNode>;
      let node: SchemaNode | undefined = properties[member];
      while (typeof node?.$ref === "string")
        node = irDefinition(node.$ref.slice(node.$ref.lastIndexOf("/") + 1));
      return node?.[KNOWN_VALUES_KEYWORD] as string[];
    };
    for (const [key, parts] of Object.entries(IR_PARTITIONS)) {
      const flat = parts.flat();
      expect(new Set(flat).size, `${key} parts overlap`).toBe(flat.length);
      expect([...flat].sort(), key).toEqual([...knownOf(key)].sort());
    }
  });

  test("leaves unknown values to the reader", () => {
    // Each object breaks its rule as read with a known value: a versionToken header has no 'name', a 'source'
    // meta member has 'source', a response name has 'status', a principal source has 'name'.
    const later = "zzLater";
    expect(
      broken(
        "HeaderDecl",
        (header) => {
          header.semantic = later;
        },
        (header) => header.semantic === "versionToken",
      ),
    ).toEqual([]);
    expect(
      broken(
        "MetaMember",
        (meta) => {
          meta.fill = later;
        },
        (meta) => meta.fill === "source",
      ),
    ).toEqual([]);
    expect(
      broken(
        "Name",
        (name) => {
          name.role = later;
        },
        (name) => name.role === "response",
      ),
    ).toEqual([]);
    expect(
      broken(
        "ValueSource",
        (source) => {
          source.in = later;
        },
        (source) => source.in === "principal",
      ),
    ).toEqual([]);
  });

  test("every catalogue id names an existing entry", () => {
    const ir = sample("every-member.ir.json");
    const schemes = ir.schemes as Record<string, Record<string, unknown>>;
    (schemes.sessionCookie as Record<string, unknown>).csrf = "missing";
    const identities = ir.identities as Record<string, Record<string, unknown>>;
    (identities.user as Record<string, unknown>).principal = { kind: "schema", schema: "Missing" };
    const api = ir.api as Record<string, Record<string, unknown>>;
    (api.documents as Record<string, Record<string, unknown>>).public = {
      surfaces: ["nowhere"],
      internal: "exclude",
    };
    // A key read with Object.hasOwn: an id spelled like a prototype member resolves to nothing.
    const rights = ir.rights as Record<string, Record<string, unknown>>;
    (rights["tasks.read"] as Record<string, unknown>).id = "constructor";
    // Ids are type uses: a scope id names a missing named format, a resource id a missing enum.
    const scopes = ir.scopes as Record<string, Record<string, unknown>>;
    ((scopes.workspace as Record<string, unknown>).idSchema as Record<string, unknown>).scalar =
      "missingId";
    (
      (rights["tasks.update"] as Record<string, unknown>).subject as Record<string, unknown>
    ).idSchema = { kind: "enum", enum: "MissingId" };
    expect(checkIrInvariants(ir)).toEqual([
      expect.objectContaining({
        id: "ir.ref.resolves",
        pointer: "/api/documents/public/surfaces/0",
      }),
      expect.objectContaining({ id: "ir.ref.resolves", pointer: "/schemes/sessionCookie/csrf" }),
      expect.objectContaining({
        id: "ir.ref.resolves",
        pointer: "/identities/user/principal/schema",
      }),
      expect.objectContaining({ id: "ir.ref.resolves", pointer: "/rights/tasks.read/id" }),
      expect.objectContaining({
        id: "ir.ref.resolves",
        pointer: "/rights/tasks.update/subject/idSchema/enum",
      }),
      expect.objectContaining({
        id: "ir.ref.resolves",
        pointer: "/scopes/workspace/idSchema/scalar",
      }),
    ]);
  });
});
