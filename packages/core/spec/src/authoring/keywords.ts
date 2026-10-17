// ADR 0003 section 1: every keyword of the JSON Schema 2020-12 vocabularies, kept or refused.
// The authoring schemas write each refused keyword as a property that never validates, with its
// reason as the description (so editors show it), and the validate stage quotes `reason` and `fix`.

export type SchemaKeywordDecision = "kept" | "refused";

export interface SchemaKeyword {
  keyword: string;
  decision: SchemaKeywordDecision;
  // The ADR 0003 section that gives the keyword its meaning or its refusal.
  section: string;
  reason: string;
  // What to write instead; for a kept keyword, what to write instead of a refused form of it.
  fix: string;
  // A kept keyword with a refused value form (`additionalProperties: false`, `type: [string, 'null']`).
  refusedForm?: { reason: string; fix: string };
}

const S1 = "ADR 0003 section 1";

export const SCHEMA_KEYWORDS: readonly SchemaKeyword[] = [
  // Core vocabulary
  {
    keyword: "$schema",
    decision: "refused",
    section: S1,
    reason: "the dialect is fixed by seampact and the authoring schema",
    fix: "remove '$schema'",
  },
  {
    keyword: "$id",
    decision: "refused",
    section: S1,
    reason: "a schema's identity is its catalogue name; a second identifier would be a second fact",
    fix: "remove '$id' and use the schema's catalogue name",
  },
  {
    keyword: "$ref",
    decision: "kept",
    section: S1,
    reason: "identity-preserving references by name or file",
    fix: "write '$ref' beside marks and annotations only (ADR 0003 section 6)",
  },
  {
    keyword: "$anchor",
    decision: "refused",
    section: S1,
    reason: "names live in the catalogue",
    fix: "declare the schema in the 'schemas' catalogue and reference it by name",
  },
  {
    keyword: "$dynamicRef",
    decision: "refused",
    section: S1,
    reason: "generic, late-bound schemas have no counterpart in any target's type system",
    fix: "reference a named schema with '$ref'",
  },
  {
    keyword: "$dynamicAnchor",
    decision: "refused",
    section: S1,
    reason: "generic, late-bound schemas have no counterpart in any target's type system",
    fix: "declare the schema in the 'schemas' catalogue and reference it by name",
  },
  {
    keyword: "$vocabulary",
    decision: "refused",
    section: S1,
    reason: "the vocabulary is fixed",
    fix: "remove '$vocabulary'",
  },
  {
    keyword: "$comment",
    decision: "refused",
    section: S1,
    reason: "YAML comments serve; a '$comment' would reach no output",
    fix: "write a YAML comment ('# ...') or a 'description'",
  },
  {
    keyword: "$defs",
    decision: "refused",
    section: S1,
    reason: "named schemas live in the 'schemas' catalogue, one place",
    fix: "move each definition into the 'schemas' catalogue and reference it by name",
  },
  // Applicator vocabulary
  {
    keyword: "allOf",
    decision: "kept",
    section: S1,
    reason: "every member is an object schema, merged into one object by the compiler",
    fix: "list object schemas only",
  },
  {
    keyword: "anyOf",
    decision: "refused",
    section: S1,
    reason:
      "an untagged union cannot be decoded by a client without trying each branch, and validators disagree on overlaps",
    fix: "use 'oneOf' with a 'discriminator', 'nullable: true', or an opaque value with its reason",
  },
  {
    keyword: "oneOf",
    decision: "kept",
    section: "ADR 0003 section 3",
    reason: "tagged only: a mapping from tag value to variant, with a discriminator",
    fix: "write 'oneOf' as a mapping from tag to variant beside 'discriminator'",
  },
  {
    keyword: "not",
    decision: "refused",
    section: S1,
    reason:
      "negative constraints have no native form in Bean Validation, Laravel or Symfony constraints",
    fix: "state the accepted values positively (an enum, a pattern, a range)",
  },
  {
    keyword: "if",
    decision: "refused",
    section: S1,
    reason: "conditional validation is not portable and hides two types in one",
    fix: "use a tagged union ('oneOf' with a 'discriminator')",
  },
  {
    keyword: "then",
    decision: "refused",
    section: S1,
    reason: "conditional validation is not portable and hides two types in one",
    fix: "use a tagged union ('oneOf' with a 'discriminator')",
  },
  {
    keyword: "else",
    decision: "refused",
    section: S1,
    reason: "conditional validation is not portable and hides two types in one",
    fix: "use a tagged union ('oneOf' with a 'discriminator')",
  },
  {
    keyword: "dependentSchemas",
    decision: "refused",
    section: S1,
    reason: "conditional validation is not portable and hides two types in one",
    fix: "use a tagged union ('oneOf' with a 'discriminator')",
  },
  {
    keyword: "prefixItems",
    decision: "refused",
    section: S1,
    reason: "tuples map to no record or class type",
    fix: "use an object, or an opaque value with its reason for a third party's tuple",
  },
  {
    keyword: "items",
    decision: "kept",
    section: S1,
    reason: "an array has exactly one item schema",
    fix: "write one schema under 'items'",
  },
  {
    keyword: "contains",
    decision: "refused",
    section: S1,
    reason: "no native counterpart in most targets; no consumer",
    fix: "remove 'contains'; check the item schema with 'items'",
  },
  { keyword: "properties", decision: "kept", section: S1, reason: "", fix: "" },
  {
    keyword: "patternProperties",
    decision: "refused",
    section: S1,
    reason: "key-dependent schemas map to no type",
    fix: "use a map: 'additionalProperties: <schema>' with 'propertyNames'",
  },
  {
    keyword: "additionalProperties",
    decision: "kept",
    section: S1,
    reason: "map form only: a map with string keys on an object without 'properties'",
    fix: "write 'additionalProperties: <schema>' on an object without 'properties'",
    refusedForm: {
      reason: "'true' and 'false' are refused because direction decides strictness",
      fix: "remove it, or set 'unknownKeys' on the input use (ADR 0003 section 4)",
    },
  },
  {
    keyword: "propertyNames",
    decision: "kept",
    section: S1,
    reason: "map form only: the key schema of a map",
    fix: "write a string schema under 'propertyNames' beside 'additionalProperties'",
  },
  // Unevaluated vocabulary
  {
    keyword: "unevaluatedItems",
    decision: "refused",
    section: S1,
    reason: "direction decides how unknown fields are treated",
    fix: "remove it; input refuses unknown items and output tolerates them",
  },
  {
    keyword: "unevaluatedProperties",
    decision: "refused",
    section: S1,
    reason: "direction decides how unknown fields are treated",
    fix: "remove it, or set 'unknownKeys' on the input use (ADR 0003 section 4)",
  },
  // Validation vocabulary
  {
    keyword: "type",
    decision: "kept",
    section: S1,
    reason: "one value: string, integer, number, boolean, object or array",
    fix: "write one type",
    refusedForm: {
      reason: "'null' and type arrays are refused; nullability is 'nullable' (ADR 0003 section 5)",
      fix: "write one type and 'nullable: true'",
    },
  },
  {
    keyword: "const",
    decision: "refused",
    section: S1,
    reason:
      "a one-value field is an enum or a union tag; keeping both would give two ways to state it",
    fix: "use a catalogue enum, or a union tag",
  },
  {
    keyword: "enum",
    decision: "kept",
    section: "ADR 0003 section 7",
    reason: "by reference: 'enum: <EnumName>' or a narrowing",
    fix: "write 'enum: <EnumName>' or 'enum: { narrow, to }'",
    refusedForm: {
      reason:
        "inline value lists are refused because enums live in one catalogue, where each is declared once with its values, source and fallback",
      fix: "declare the values in the 'enums' catalogue and write 'enum: <EnumName>'",
    },
  },
  {
    keyword: "multipleOf",
    decision: "kept",
    section: S1,
    reason: "on integer and decimal",
    fix: "use it on an integer or a decimal",
  },
  { keyword: "maximum", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "exclusiveMaximum", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "minimum", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "exclusiveMinimum", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "maxLength", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "minLength", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "pattern", decision: "kept", section: "ADR 0003 section 9", reason: "", fix: "" },
  { keyword: "maxItems", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "minItems", decision: "kept", section: S1, reason: "", fix: "" },
  {
    keyword: "uniqueItems",
    decision: "refused",
    section: S1,
    reason:
      'no native, exact check in Bean Validation or class-validator, and "equal" differs for objects; no consumer',
    fix: "remove 'uniqueItems'; the handler deduplicates",
  },
  {
    keyword: "maxContains",
    decision: "refused",
    section: S1,
    reason: "'contains' is refused",
    fix: "remove 'maxContains'",
  },
  {
    keyword: "minContains",
    decision: "refused",
    section: S1,
    reason: "'contains' is refused",
    fix: "remove 'minContains'",
  },
  {
    keyword: "maxProperties",
    decision: "refused",
    section: S1,
    reason: "no consumer; map size limits wait for one",
    fix: "remove 'maxProperties'",
  },
  {
    keyword: "minProperties",
    decision: "refused",
    section: S1,
    reason: "no consumer; map size limits wait for one",
    fix: "remove 'minProperties'",
  },
  { keyword: "required", decision: "kept", section: "ADR 0003 section 5", reason: "", fix: "" },
  {
    keyword: "dependentRequired",
    decision: "refused",
    section: S1,
    reason: "conditional presence",
    fix: "use a tagged union ('oneOf' with a 'discriminator')",
  },
  // Format annotation, content and meta-data vocabularies
  { keyword: "format", decision: "kept", section: "ADR 0003 section 8", reason: "", fix: "" },
  {
    keyword: "contentMediaType",
    decision: "kept",
    section: S1,
    reason: "on a string field of a form or multipart input only, with 'application/json'",
    fix: "write 'contentMediaType: application/json' with 'contentSchema'",
  },
  {
    keyword: "contentSchema",
    decision: "kept",
    section: S1,
    reason: "the schema of a JSON text field",
    fix: "write it beside 'contentMediaType: application/json'",
  },
  {
    keyword: "contentEncoding",
    decision: "refused",
    section: S1,
    reason: "base64 inside JSON has no consumer; files travel as multipart parts or downloads",
    fix: "use a file field of a multipart input, or a file download",
  },
  { keyword: "title", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "description", decision: "kept", section: S1, reason: "", fix: "" },
  { keyword: "default", decision: "kept", section: "ADR 0003 section 10", reason: "", fix: "" },
  { keyword: "deprecated", decision: "kept", section: S1, reason: "", fix: "" },
  {
    keyword: "readOnly",
    decision: "refused",
    section: S1,
    reason:
      "they make one schema stand for two types; a payload that differs between input and output is two schemas",
    fix: "declare two schemas, the input one derived with 'pick' or 'omit'",
  },
  {
    keyword: "writeOnly",
    decision: "refused",
    section: S1,
    reason:
      "they make one schema stand for two types; a payload that differs between input and output is two schemas",
    fix: "declare two schemas, the input one derived with 'pick' or 'omit'",
  },
  { keyword: "examples", decision: "kept", section: "ADR 0003 section 11", reason: "", fix: "" },
];

export const REFUSED_SCHEMA_KEYWORDS: readonly SchemaKeyword[] = SCHEMA_KEYWORDS.filter(
  (k) => k.decision === "refused",
);

export function schemaKeyword(keyword: string): SchemaKeyword | undefined {
  return SCHEMA_KEYWORDS.find((k) => k.keyword === keyword);
}
