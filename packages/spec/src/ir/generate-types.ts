import { isSchemaNode } from "./schema-walk.js";
import { IR_SCHEMA_DOCUMENTS, type SchemaNode } from "./schemas.js";
import { KNOWN_VALUES_KEYWORD, MUST_ACT_KEYWORD } from "./validation.js";

// The in-repo generator of the IR TypeScript types (ADR 0005 section 5: readers' models are generated from the
// one IR JSON Schema). It reads only the subset the schema files use (README.md) and fails on anything else, so
// a new construct is a change here, reviewed, rather than a silent `unknown`. Its output is formatted by Biome
// and committed as `types.generated.ts`; `types.test.ts` regenerates it and fails on any difference.
//
// Mapping:
// - a definition with `properties`: an interface; a member outside `required` is optional (`name?: T`);
// - `$ref`: the referenced definition's name (definition names are unique across the files);
// - a definition with `oneOf` and `discriminator` (a tagged union): `Known<Name>`, the closed union of its
//   variants, and `<Name>`, that union plus `UnknownVariant<tag>`, the explicit unknown arm whose tag is typed
//   `string & {}` (ADR 0005 section 3: the tag stays open). TypeScript narrows no union holding that arm, so a
//   reader first narrows to `Known<Name>` with `isKnownVariant` and handles the unknown arm by name;
//   `IrUnionMap` lists every union for that guard;
// - a string with `const` (a union tag): that literal;
// - a string with the known-values annotation (an open enum): `"a" | "b" | (string & {})`;
// - a string whose `pattern` is an anchored alternation of words and `word:[^#]+` prefixes: the closed union
//   of those literals and template literals (Origin's layer);
// - `integer` and `number`: `number`; `boolean`; an array: `T[]`;
// - an object with `additionalProperties` (a map): `Record<K, V>`, K from `propertyNames` when it is a `$ref`;
// - a schema with no shape keyword (an opaque value): `unknown`.
export function generateIrTypes(documents: readonly SchemaNode[] = IR_SCHEMA_DOCUMENTS): string {
  const names = new Set<string>();
  const out: string[] = [
    "// Generated from packages/spec/schemas/ir/*.schema.json by src/ir/generate-types.ts. Do not edit.",
    "// Regenerate: UPDATE_IR_TYPES=1 pnpm vitest run packages/spec/src/ir/types.test.ts",
    "",
    "/** The unknown arm of a tagged union: a variant this revision does not know, named by its tag. */",
    "export type UnknownVariant<Tag extends string> = { [K in Tag]: string & {} };",
    "",
  ];
  const unions: string[] = [];
  for (const document of documents) {
    const defs = document.$defs;
    if (!isSchemaNode(defs)) continue;
    for (const [name, def] of Object.entries(defs)) {
      if (!isSchemaNode(def)) throw new Error(`${name}: not a schema`);
      if (names.has(name)) throw new Error(`${name}: defined twice across the IR schema files`);
      names.add(name);
      out.push(...docComment(description(def), ""));
      if (isSchemaNode(def.discriminator)) {
        if (!Array.isArray(def.oneOf)) throw new Error(`${name}: discriminator without oneOf`);
        const tag = String(def.discriminator.propertyName);
        const variants = def.oneOf.map((variant) => typeOf(variant as SchemaNode, name));
        out.push(`export type Known${name} = ${variants.join(" | ")};`, "");
        out.push(...docComment(description(def), ""));
        out.push(`export type ${name} = Known${name} | UnknownVariant<"${tag}">;`, "");
        unions.push(`  ${name}: { union: ${name}; known: Known${name} };`);
      } else if (isSchemaNode(def.properties)) {
        out.push(`export interface ${name} ${objectType(def, name)}`, "");
      } else {
        out.push(`export type ${name} = ${typeOf(def, name)};`, "");
      }
    }
  }
  out.push(
    "/** Every tagged union of the IR, for `isKnownVariant`. */",
    "export interface IrUnionMap {",
    ...unions,
    "}",
    "",
  );
  return out.join("\n");
}

// A definition's description, with the must-act rule when the definition carries it: an unknown tag for a
// union, an unknown value for an open enum.
function description(def: SchemaNode): string | undefined {
  if (def[MUST_ACT_KEYWORD] !== true)
    return typeof def.description === "string" ? def.description : undefined;
  const unknown = isSchemaNode(def.discriminator) ? "an unknown tag" : "an unknown value";
  const rule = `Must act: ${unknown} makes the IR invalid for every reader.`;
  return typeof def.description === "string" ? `${def.description} ${rule}` : rule;
}

function docComment(description: unknown, indent: string): string[] {
  return typeof description === "string" ? [`${indent}/** ${description} */`] : [];
}

function objectType(node: SchemaNode, at: string): string {
  const properties = node.properties as Record<string, SchemaNode>;
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  const lines = ["{"];
  for (const [member, schema] of Object.entries(properties)) {
    lines.push(...docComment(description(schema), "  "));
    const optional = required.has(member) ? "" : "?";
    lines.push(`  ${member}${optional}: ${typeOf(schema, `${at}.${member}`)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

const refName = (ref: string): string => ref.slice(ref.lastIndexOf("/") + 1);

const PREFIX_SUFFIX = ":[^#]+";
const LITERAL_ALTERNATION = /^\^\(([a-z]+(?::\[\^#\]\+)?(?:\|[a-z]+(?::\[\^#\]\+)?)*)\)\$$/;

function typeOf(node: SchemaNode, at: string): string {
  if (typeof node.$ref === "string") return refName(node.$ref);
  if (Array.isArray(node.oneOf))
    throw new Error(`${at}: a tagged union is a definition of its own`);
  switch (node.type) {
    case "string":
      return stringType(node);
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      if (!isSchemaNode(node.items)) throw new Error(`${at}: array without items`);
      const items = typeOf(node.items, `${at}[]`);
      return /[|&]/.test(items) ? `(${items})[]` : `${items}[]`;
    }
    case "object": {
      if (isSchemaNode(node.properties)) return objectType(node, at);
      if (!isSchemaNode(node.additionalProperties))
        throw new Error(`${at}: object without a shape`);
      const keys = isSchemaNode(node.propertyNames) && typeof node.propertyNames.$ref === "string";
      const key = keys ? refName((node.propertyNames as SchemaNode).$ref as string) : "string";
      return `Record<${key}, ${typeOf(node.additionalProperties, `${at}{}`)}>`;
    }
    case undefined:
      return "unknown";
    default:
      throw new Error(`${at}: type ${String(node.type)} is outside the IR schema subset`);
  }
}

function stringType(node: SchemaNode): string {
  if (typeof node.const === "string") return JSON.stringify(node.const);
  const known = node[KNOWN_VALUES_KEYWORD];
  if (Array.isArray(known))
    return [...known.map((v) => JSON.stringify(v)), "(string & {})"].join(" | ");
  if (typeof node.pattern === "string") {
    const match = LITERAL_ALTERNATION.exec(node.pattern);
    if (match?.[1] !== undefined) {
      return match[1]
        .split("|")
        .map((word) =>
          word.endsWith(PREFIX_SUFFIX)
            ? `\`${word.slice(0, -PREFIX_SUFFIX.length + 1)}\${string}\``
            : `"${word}"`,
        )
        .join(" | ");
    }
  }
  return "string";
}
