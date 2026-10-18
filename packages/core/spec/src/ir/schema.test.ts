import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import everyMember from "../../schemas/ir/examples/every-member.ir.json" with { type: "json" };
import { isSchemaNode, walkSchema } from "./schema-walk.js";
import { IR_SCHEMA_DOCUMENTS, IR_SCHEMA_ID, type SchemaNode } from "./schemas.js";
import { createAjv, mutateAt, validateIr } from "./test-support.js";
import { KNOWN_VALUES_KEYWORD, MUST_ACT_KEYWORD, strictIrSchemas } from "./validation.js";

const defs = new Map<string, SchemaNode>();

for (const document of IR_SCHEMA_DOCUMENTS) {
  for (const [name, def] of Object.entries(document.$defs as Record<string, SchemaNode>))
    defs.set(name, def);
}

const def = (name: string): SchemaNode => {
  const found = defs.get(name);

  if (found === undefined) throw new Error(`no definition ${name}`);

  return found;
};

// ADR 0004 section 13: the unions and enums a reader must understand to enforce a security boundary.
const MUST_ACT = [
  "Access",
  "Requirement",
  "RightSubject",
  "SignatureVerify",
  "SchemeKey",
  "UnknownQuery",
  "Scheme",
  "Identity",
  "KeysPolicy",
  "RefusedCredential",
  "UnknownKeysPolicy",
  "InputPolicy",
  "Idempotency",
  "Csrf",
  "FieldRightAlways",
  "ValueSourceIn",
];
// Map keys with no grammar in ADR 0002 section 4 (principal variant names); readers use Object.hasOwn.
const KEYS_WITHOUT_GRAMMAR = ["VariantId"];
const refName = (ref: unknown): string => String(ref).slice(String(ref).lastIndexOf("/") + 1);

// Every node of every file, with `file#pointer` for messages.
function allNodes(): { node: SchemaNode; at: string; parentKeyword: string | undefined }[] {
  const nodes: { node: SchemaNode; at: string; parentKeyword: string | undefined }[] = [];

  for (const document of IR_SCHEMA_DOCUMENTS) {
    const file = String(document.$id).slice(String(document.$id).lastIndexOf("/") + 1);

    walkSchema(document, (node, pointer, parentKeyword) =>
      nodes.push({ node, at: `${file}#${pointer}`, parentKeyword }),
    );
  }

  return nodes;
}

// The tag property schema of every variant of every union: the only place a `const` may stand.
function unionTagSchemas(): Set<SchemaNode> {
  const tags = new Set<SchemaNode>();

  for (const { node } of allNodes()) {
    if (!isSchemaNode(node.discriminator)) continue;
    const tag = String(node.discriminator.propertyName);

    for (const variant of node.oneOf as SchemaNode[]) {
      const properties = def(refName(variant.$ref)).properties as Record<string, SchemaNode>;
      const tagSchema = properties[tag];

      if (tagSchema !== undefined) tags.add(tagSchema);
    }
  }

  return tags;
}

describe("IR schema files", () => {
  test("metaschema", () => {
    const ajv = createAjv("open");

    for (const document of [...IR_SCHEMA_DOCUMENTS, ...strictIrSchemas()]) {
      expect(ajv.validateSchema(document), JSON.stringify(ajv.errors)).toBe(true);
    }

    // Compiling in strict mode throws on an unknown keyword, a strict-types or strict-required violation.
    expect(createAjv("open").getSchema(IR_SCHEMA_ID)).toBeTypeOf("function");
    expect(createAjv("strict").getSchema(IR_SCHEMA_ID)).toBeTypeOf("function");
  });

  test("no closed enum", () => {
    const tags = unionTagSchemas();
    const offenders: string[] = [];

    for (const { node, at } of allNodes()) {
      if ("enum" in node) offenders.push(`${at}: enum`);

      if ("const" in node && !tags.has(node)) offenders.push(`${at}: const outside a union tag`);

      if (KNOWN_VALUES_KEYWORD in node && node.type !== "string") {
        offenders.push(`${at}: known values on a non-string`);
      }
    }

    expect(offenders).toEqual([]);

    for (const tag of tags) expect(typeof tag.const).toBe("string");
  });

  test("extension slots", () => {
    // ADR 0004 section 3: api, operation, schema, property, right, rule and scope.
    const extendable = [
      "Api",
      "ObjectSchema",
      "MapSchema",
      "UnionSchema",
      "Property",
      "Right",
      "Rule",
      "Scope",
      ...(defs.has("Operation") ? ["Operation"] : []),
    ];

    for (const name of extendable) {
      const node = def(name);

      expect((node.properties as Record<string, SchemaNode>).extensions, name).toEqual({
        $ref: "common.schema.json#/$defs/Extensions",
      });
      expect(node.required, name).toContain("extensions");
    }
  });

  test("subset keywords only", () => {
    // ADR 0003 section 1 kept keywords, plus the union idiom (`discriminator`, a `const` tag) and the
    // known-values annotation; `$schema`, `$id` and `$defs` only at a file's root (README.md).
    const kept = new Set([
      "$ref",
      "type",
      "properties",
      "required",
      "items",
      "additionalProperties",
      "propertyNames",
      "oneOf",
      "discriminator",
      "const",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      "minLength",
      "maxLength",
      "pattern",
      "minItems",
      "maxItems",
      "title",
      "description",
      "default",
      "deprecated",
      "examples",
      KNOWN_VALUES_KEYWORD,
      MUST_ACT_KEYWORD,
    ]);
    const rootOnly = new Set(["$schema", "$id", "$defs"]);
    const offenders: string[] = [];

    for (const { node, at } of allNodes()) {
      const isRoot = at.endsWith("#");

      for (const keyword of Object.keys(node)) {
        if (!kept.has(keyword) && !(isRoot && rootOnly.has(keyword)))
          offenders.push(`${at}: ${keyword}`);
      }

      if ("anyOf" in node) offenders.push(`${at}: anyOf`);

      if ("oneOf" in node && !isSchemaNode(node.discriminator))
        offenders.push(`${at}: untagged oneOf`);

      if ("discriminator" in node) {
        const keys = Object.keys(node.discriminator as SchemaNode);

        if (keys.join() !== "propertyName") offenders.push(`${at}: discriminator ${keys.join()}`);

        if ("properties" in node) offenders.push(`${at}: a union wrapper declares properties`);
      }

      if (MUST_ACT_KEYWORD in node && !("discriminator" in node || KNOWN_VALUES_KEYWORD in node)) {
        offenders.push(`${at}: must-act outside a union or an open enum`);
      }

      if ("type" in node && (typeof node.type !== "string" || node.type === "null")) {
        offenders.push(`${at}: type must be one non-null type`);
      }

      if ("additionalProperties" in node) {
        if (!isSchemaNode(node.additionalProperties) || "properties" in node) {
          offenders.push(`${at}: additionalProperties outside the map form`);
        }
      }

      if ("propertyNames" in node && !("additionalProperties" in node)) {
        offenders.push(`${at}: propertyNames outside the map form`);
      }

      if (
        typeof node.$ref === "string" &&
        !/^([a-z-]+\.schema\.json)?#\/\$defs\/\w+$/.test(node.$ref)
      ) {
        offenders.push(`${at}: $ref ${node.$ref} is not a relative reference to a definition`);
      }

      if (typeof node.$ref === "string" && !defs.has(refName(node.$ref)))
        offenders.push(`${at}: dangling`);
    }

    expect(offenders).toEqual([]);
  });

  test("objects, unions and open enums are named definitions", () => {
    // A generated model names every type: no anonymous object, union or open enum inside a member.
    const offenders: string[] = [];

    for (const { node, at } of allNodes()) {
      const shaped =
        "properties" in node || "discriminator" in node || KNOWN_VALUES_KEYWORD in node;

      if (shaped && !/#\/\$defs\/\w+$/.test(at)) offenders.push(at);
    }

    expect(offenders).toEqual([]);
  });

  test("must-act marks the security-boundary unions and enums", () => {
    // README.md: an unknown tag or value there makes the IR invalid for every reader.
    const marked = [...defs].filter(([, node]) => node[MUST_ACT_KEYWORD] === true).map(([n]) => n);

    expect(marked.sort()).toEqual(MUST_ACT.filter((name) => defs.has(name)).sort());
  });

  test("catalogue keys follow the grammars of ADR 0002 section 4", () => {
    const offenders: string[] = [];

    for (const { node, at } of allNodes()) {
      if (!isSchemaNode(node.propertyNames)) continue;
      const names = node.propertyNames;
      const key = typeof names.$ref === "string" ? def(refName(names.$ref)) : names;
      const pattern = typeof key.pattern === "string" ? new RegExp(key.pattern, "u") : undefined;

      if (pattern === undefined) {
        if (!KEYS_WITHOUT_GRAMMAR.includes(refName(names.$ref))) offenders.push(at);
        continue;
      }

      // A right takes any name its library uses (A20), `__proto__` included: readers use Object.hasOwn.
      const refused =
        refName(names.$ref) === "RightId" ? ["", " a", "a "] : ["__proto__", "", " a"];

      for (const bad of refused) if (pattern.test(bad)) offenders.push(`${at}: ${bad}`);
    }

    expect(offenders).toEqual([]);
  });

  test("deterministic files", () => {
    // Requirement 9: no timestamp, absolute path or machine-dependent value; stable ids under one base.
    for (const document of IR_SCHEMA_DOCUMENTS) {
      const text = JSON.stringify(document);

      expect(String(document.$id)).toMatch(
        /^https:\/\/seampact\.dev\/schemas\/ir\/[a-z-]+\.schema\.json$/,
      );
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T|file:|\/home\/|\/Users\/|[A-Z]:\\\\/);
    }
  });

  test("every integer is bounded to the safe range", () => {
    // I-JSON (RFC 7493): every reader holds an IR integer exactly, a JavaScript number included.
    const integers: string[] = [];

    for (const document of IR_SCHEMA_DOCUMENTS)
      walkSchema(document, (node, pointer) => {
        if (node.type !== "integer") return;
        integers.push(pointer);
        expect(node.minimum, pointer).toBeGreaterThanOrEqual(-Number.MAX_SAFE_INTEGER);
        expect(node.maximum, pointer).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      });

    expect(integers.length).toBeGreaterThan(20);
  });

  test("catalogues are maps keyed by id and declarations are referenced by id", () => {
    const contract = def("ContractIR").properties as Record<string, SchemaNode>;
    // ADR 0004 section 2: every `Record<Id, Decl>` of the top level.
    const catalogues = [
      "formats",
      "pagings",
      "schemas",
      "scalars",
      "enums",
      "errors",
      "natures",
      "schemes",
    ];

    catalogues.push(
      "headers",
      "identities",
      "rights",
      "rules",
      "scopes",
      "buckets",
      "services",
      "extensionKeys",
    );
    const catalogueValues = new Set<string>();

    for (const [member, schema] of Object.entries(contract)) {
      const isMap = schema.type === "object" && "additionalProperties" in schema;

      expect(isMap, member).toBe(catalogues.includes(member));

      if (!isMap) continue;
      expect(schema.propertyNames, member).toMatchObject({
        $ref: expect.stringMatching(/Id|ErrorCode/),
      });
      catalogueValues.add(refName((schema.additionalProperties as SchemaNode).$ref));
    }

    // A catalogue entry's definition is reached only through its catalogue (or as a union variant of it).
    const offenders: string[] = [];

    for (const { node, at, parentKeyword } of allNodes()) {
      if (typeof node.$ref !== "string" || !catalogueValues.has(refName(node.$ref))) continue;

      if (
        !at.startsWith("ir.schema.json#/$defs/ContractIR/") ||
        parentKeyword !== "additionalProperties"
      ) {
        offenders.push(`${at} nests ${refName(node.$ref)}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  test("identity header semantics are response header semantics", () => {
    // An identity header a response carries keeps its semantic on Response.headers.
    const identity = def("HeaderSemantic")[KNOWN_VALUES_KEYWORD] as string[];
    const response = def("ResponseHeaderSemantic")[KNOWN_VALUES_KEYWORD] as string[];

    expect(response.slice(0, identity.length)).toEqual(identity);
  });

  test("every IR array has a stated order", () => {
    // ADR 0004 section 9 states the order of each array by `Definition.member`; a new array fails here until stated.
    const stated = statedArrayOrders();
    const unstated: string[] = [];
    const reached = new Set<string>();

    for (const document of IR_SCHEMA_DOCUMENTS)
      walkSchema(document, (node, pointer) => {
        if (node.type !== "array") return;
        const key = arrayKey(pointer);
        const row = key.endsWith(".examples") ? "*.examples" : key;

        if (stated.has(row)) reached.add(row);
        else unstated.push(key);
      });

    expect(unstated).toEqual([]);
    expect([...stated].filter((row) => !reached.has(row))).toEqual([]);
  });
});

const ORDERING_SECTION = new URL(
  "../../../../../docs/ir/09-canonical-ids-and-ordering.md",
  import.meta.url,
);
const ORDER_ROW = /^\| `([A-Za-z*]+\.[A-Za-z]+)` \| (Kept|Sorted)\b/gmu;

function statedArrayOrders(): Set<string> {
  const text = readFileSync(ORDERING_SECTION, "utf8");

  return new Set([...text.matchAll(ORDER_ROW)].map((match) => String(match[1])));
}

// `/$defs/Operation/properties/errors` is `Operation.errors`; an array below a member keeps its member's key.
function arrayKey(pointer: string): string {
  const [, , definition, keyword, member] = pointer.split("/");

  return keyword === "properties" ? `${definition}.${member}` : String(definition);
}

describe("IR instance forms", () => {
  const sample = (): unknown => structuredClone(everyMember);

  test("an api without wire is refused", () => {
    const ir = mutateAt(sample(), "/api", (api) => {
      delete api.wire;
    });

    expect(validateIr(ir, "open")).toMatchObject({
      valid: false,
      problems: [{ pointer: "/api", keyword: "required" }],
    });
  });

  test("a degradable header name that is no token is refused", () => {
    const ir = mutateAt(sample(), "/operations/2/degradable", (degradable) => {
      degradable.header = "X Degraded";
    });

    expect(validateIr(ir, "open")).toMatchObject({
      valid: false,
      problems: [{ pointer: "/operations/2/degradable/header", keyword: "pattern" }],
    });
  });

  test("a successor rel outside the registered name form is refused", () => {
    for (const rel of ["Successor", "successor version", "1successor", ""]) {
      const ir = mutateAt(sample(), "/operations/2/deprecated", (deprecated) => {
        deprecated.successorRel = rel;
      });

      expect(validateIr(ir, "open"), rel).toMatchObject({
        valid: false,
        problems: [{ pointer: "/operations/2/deprecated/successorRel", keyword: "pattern" }],
      });
    }
  });

  test("empty roles are refused", () => {
    const ir = mutateAt(sample(), "/operations/2/errors/2", (error) => {
      error.roles = [];
    });

    expect(validateIr(ir, "open")).toMatchObject({
      valid: false,
      problems: [{ pointer: "/operations/2/errors/2/roles", keyword: "minItems" }],
    });
  });
});
