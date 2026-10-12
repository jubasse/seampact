import { describe, expect, test } from "vitest";
import { isSchemaNode, walkSchema } from "./schema-walk.js";
import { IR_SCHEMA_DOCUMENTS, IR_SCHEMA_ID, type SchemaNode } from "./schemas.js";
import { createAjv } from "./test-support.js";
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
  "SignatureScheme",
  "UnknownQuery",
  "SchemeKind",
  "IdentityKind",
  "RefusedCredential",
  "UnknownKeysPolicy",
  "InputPolicy",
  "Idempotency",
  "Csrf",
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
});
