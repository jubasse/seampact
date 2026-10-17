import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { irDefinition, KNOWN_VALUES_KEYWORD, walkIrInstance } from "./instance-walk.js";
import { checkIrInvariants, IR_PARTITIONS, type IrInvariantId } from "./invariants.js";
import { isSchemaNode } from "./schema-walk.js";
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
    expect(
      broken("InputProof", (proof) => {
        proof.schema = { kind: "file", media: ["image/png"] };
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
    const propertyOf = (schema: SchemaNode | undefined, member: string): SchemaNode | undefined => {
      const properties = schema?.properties;
      const property = isSchemaNode(properties) ? properties[member] : undefined;

      return isSchemaNode(property) ? property : undefined;
    };

    const definitionName = (ref: unknown): string =>
      String(ref).slice(String(ref).lastIndexOf("/") + 1);
    const knownOf = (key: string): string[] => {
      const [definition = "", member = ""] = key.split(".");
      // A tagged union's known list is the tag of each variant (`TypeUse`, `Schema`).
      const variants: unknown = irDefinition(definition)?.oneOf;

      if (Array.isArray(variants))
        return variants
          .filter(isSchemaNode)
          .map((variant) =>
            String(propertyOf(irDefinition(definitionName(variant.$ref)), member)?.const),
          );
      let node = propertyOf(irDefinition(definition), member);

      while (typeof node?.$ref === "string") node = irDefinition(definitionName(node.$ref));
      const known = node?.[KNOWN_VALUES_KEYWORD];

      return Array.isArray(known) ? known.map(String) : [];
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

  test("a body proof's type use names existing entries", () => {
    const ir = sample("every-member.ir.json");
    const [proof] = objectsOf(ir, "InputProof");

    if (proof === undefined) throw new Error("no InputProof in the sample");
    (proof.value.schema as Record<string, unknown>).scalar = "missingId";
    expect(checkIrInvariants(ir)).toEqual([
      expect.objectContaining({ id: "ir.ref.resolves", pointer: `${proof.pointer}/schema/scalar` }),
    ]);
  });

  test("a body proof has a wire form exactly when its input is form or multipart", () => {
    const check = (
      change: (input: Record<string, unknown>, proof: Record<string, unknown>) => void,
    ) => {
      const ir = sample("every-member.ir.json");
      const [input] = objectsOf(ir, "OperationInput").filter(({ value }) =>
        Array.isArray(value.proofs),
      );

      if (input === undefined) throw new Error("no input with proofs in the sample");
      const proof = (input.value.proofs as Record<string, unknown>[])[0];

      if (proof === undefined) throw new Error("no proof in the sample");
      change(input.value, proof);

      return {
        at: `${input.pointer}/proofs/0`,
        found: checkIrInvariants(ir).map(({ id, pointer }) => ({ id, pointer })),
      };
    };

    // The sample's multipart input sends its proof as a text field.
    expect(check(() => {}).found).toEqual([]);
    const missing = check((_, proof) => {
      delete proof.wire;
    });

    expect(missing.found).toEqual([{ id: "ir.input-proof.wire", pointer: missing.at }]);
    const json = check((input) => {
      input.media = "application/json";
      delete input.fields;
    });

    expect(json.found).toEqual([{ id: "ir.input-proof.wire", pointer: json.at }]);
    expect(
      check((input, proof) => {
        input.media = "application/json";
        delete input.fields;
        delete proof.wire;
      }).found,
    ).toEqual([]);
    // An unknown media type is the reader's to name; the wire itself follows ir.field-wire.members.
    expect(
      check((input) => {
        input.media = "application/zz-later";
      }).found,
    ).toEqual([]);
    const wire = check((_, proof) => {
      proof.wire = { kind: "json", style: "form" };
    });

    expect(wire.found).toEqual([{ id: "ir.field-wire.members", pointer: `${wire.at}/wire` }]);
    // A proof is never a file, so neither is its wire form.
    const file = check((_, proof) => {
      proof.wire = { kind: "file" };
    });

    expect(file.found).toEqual([{ id: "ir.input-proof.wire", pointer: file.at }]);
  });

  test("a body proof is identified by a name the body does not already carry", () => {
    const check = (
      change: (input: Record<string, unknown>, proofs: Record<string, unknown>[]) => void,
    ) => {
      const ir = sample("every-member.ir.json");
      const [input] = objectsOf(ir, "OperationInput").filter(({ value }) =>
        Array.isArray(value.proofs),
      );

      if (input === undefined) throw new Error("no input with proofs in the sample");
      change(input.value, input.value.proofs as Record<string, unknown>[]);

      return {
        at: (i: number) => `${input.pointer}/proofs/${i}`,
        found: checkIrInvariants(ir).map(({ id, pointer }) => ({ id, pointer })),
      };
    };

    const rename = (name: string) =>
      check((_, proofs) => {
        if (proofs[0] !== undefined) proofs[0].name = name;
      });
    // `title` is a property of Task, the input schema.
    const property = rename("title");

    expect(property.found).toEqual([{ id: "ir.input-proof.name", pointer: property.at(0) }]);
    // A form field named like the proof, and like no property.
    const field = check((input, proofs) => {
      const [first] = input.fields as Record<string, unknown>[];

      if (first !== undefined) first.name = "scan";

      if (proofs[0] !== undefined) proofs[0].name = "scan";
    });

    expect(field.found).toEqual([{ id: "ir.input-proof.name", pointer: field.at(0) }]);
    const twice = check((_, proofs) => {
      if (proofs[0] !== undefined) proofs.push(structuredClone(proofs[0]));
    });

    expect(twice.found).toEqual([{ id: "ir.input-proof.name", pointer: twice.at(1) }]);
    // A name is free once the schema no longer holds it.
    expect(
      check((input) => {
        input.schema = { kind: "ref", schema: "LockedParams" };
        delete input.fields;
        input.media = "application/json";

        for (const proof of input.proofs as Record<string, unknown>[]) delete proof.wire;
      }).found,
    ).toEqual([]);
  });

  test("an input with body proofs is a ref use of an object schema", () => {
    const check = (
      change: (input: Record<string, unknown>, ir: Record<string, unknown>) => void,
    ) => {
      const ir = sample("every-member.ir.json");
      const [input] = objectsOf(ir, "OperationInput").filter(({ value }) =>
        Array.isArray(value.proofs),
      );

      if (input === undefined) throw new Error("no input with proofs in the sample");
      input.value.media = "application/json";
      delete input.value.fields;

      for (const proof of input.value.proofs as Record<string, unknown>[]) delete proof.wire;
      change(input.value, ir);

      return {
        at: `${input.pointer}/schema`,
        found: checkIrInvariants(ir).map(({ id, pointer }) => ({ id, pointer })),
      };
    };

    const useOf = (schema: unknown) => (input: Record<string, unknown>) => {
      input.schema = schema;
    };

    expect(check(useOf({ kind: "ref", schema: "Task" })).found).toEqual([]);

    // Labels is a map schema, Notice a union.
    for (const schema of ["Labels", "Notice"]) {
      const result = check(useOf({ kind: "ref", schema }));

      expect(result.found, schema).toEqual([{ id: "ir.input-proof.input", pointer: result.at }]);
    }

    const scalar = check(useOf({ kind: "scalar", type: "string", refinements: {} }));

    expect(scalar.found).toEqual([{ id: "ir.input-proof.input", pointer: scalar.at }]);
    // Without proofs any input stands; an unknown use kind is the reader's to name.
    expect(
      check((input) => {
        input.schema = { kind: "ref", schema: "Labels" };
        delete input.proofs;
      }).found,
    ).toEqual([]);
    expect(check(useOf({ kind: "zz-later" })).found).toEqual([]);
    // A ref to a schema of an unknown kind is the reader's to name; a ref to a missing id breaks only
    // `ir.ref.resolves`.
    const unknownSchemaKind = check((input, ir) => {
      const schemas = ir.schemas as Record<string, Record<string, unknown>>;

      if (schemas.Labels === undefined) throw new Error("no Labels schema in the sample");
      schemas.Labels.kind = "zz-later";
      input.schema = { kind: "ref", schema: "Labels" };
    });

    expect(unknownSchemaKind.found).toEqual([]);
    const missing = check(useOf({ kind: "ref", schema: "Missing" }));

    expect(missing.found.map(({ id }) => id)).toEqual(["ir.ref.resolves"]);
  });

  test("a core origin points at its declaration under its catalogue", () => {
    const origin = (ir: Record<string, unknown>) =>
      (ir.errors as Record<string, Record<string, unknown>>)["api.internal"]?.origin as Record<
        string,
        unknown
      >;
    const at = "/errors/api.internal/origin";
    const check = (change: (origin: Record<string, unknown>) => void) => {
      const ir = sample("every-member.ir.json");

      change(origin(ir));

      return checkIrInvariants(ir).map(({ id, pointer }) => ({ id, pointer }));
    };

    expect(check(() => {})).toEqual([]);
    // Below the entry is fine; a relay route's copy names its api and is read there.
    expect(
      check((o) => {
        o.pointer = "/errors/api.internal/http";
      }),
    ).toEqual([]);
    expect(
      check((o) => {
        o.api = "billing";
        o.pointer = "/errors/api.upstream_timeout";
      }),
    ).toEqual([]);
    const violation = [{ id: "ir.origin.core", pointer: at }];

    for (const pointer of ["", "/errors", "/errors/", "/rights/tasks.read", "/surfaces/app"])
      expect(
        check((o) => {
          o.pointer = pointer;
        }),
        pointer,
      ).toEqual(violation);
    expect(
      check((o) => {
        o.pointer = "/schemas/ApiSchemaInvalidIssue";
      }),
    ).toEqual(violation);
    // Other layers keep their pointers into the authoring tree.
    expect(
      check((o) => {
        o.layer = "api";
        o.pointer = "/surfaces/app";
      }),
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
