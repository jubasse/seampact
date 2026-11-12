//! ADR 0003 section 1: every keyword of the JSON Schema 2020-12 vocabularies, kept or refused.
//!
//! The authoring schemas write each refused keyword as a property that never validates, with its
//! reason as the description, and the validate stage quotes `reason` and `fix`.

/// Whether a JSON Schema keyword is part of the schema language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SchemaKeywordDecision {
    /// The keyword is part of the schema language.
    Kept,
    /// The keyword is refused.
    Refused,
}

/// A refused value form of a kept keyword (`additionalProperties: false`, `type: [string, 'null']`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct RefusedForm {
    /// Why the form is refused.
    pub reason: &'static str,
    /// What to write instead.
    pub fix: &'static str,
}

/// The decision on one JSON Schema keyword.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SchemaKeyword {
    /// The keyword.
    pub keyword: &'static str,
    /// Kept or refused.
    pub decision: SchemaKeywordDecision,
    /// The ADR 0003 section that gives the keyword its meaning or its refusal.
    pub section: &'static str,
    /// Why it is kept with its limits, or why it is refused; empty for a kept keyword without
    /// limits.
    pub reason: &'static str,
    /// What to write instead; for a kept keyword, what to write instead of a refused form of it.
    pub fix: &'static str,
    /// A refused value form of a kept keyword.
    pub refused_form: Option<RefusedForm>,
}

/// The section most keywords are decided in.
const SECTION_1: &str = "ADR 0003 section 1";

/// Every keyword of the JSON Schema 2020-12 vocabularies, in the order of ADR 0003 section 1.
pub const SCHEMA_KEYWORDS: &[SchemaKeyword] = &[
    SchemaKeyword {
        keyword: "$schema",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "the dialect is fixed by seampact and the authoring schema",
        fix: "remove '$schema'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$id",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "a schema's identity is its catalogue name; a second identifier would be a second fact",
        fix: "remove '$id' and use the schema's catalogue name",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$ref",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "identity-preserving references by name or file",
        fix: "write '$ref' beside marks and annotations only (ADR 0003 section 6)",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$anchor",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "names live in the catalogue",
        fix: "declare the schema in the 'schemas' catalogue and reference it by name",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$dynamicRef",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "generic, late-bound schemas have no counterpart in any target's type system",
        fix: "reference a named schema with '$ref'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$dynamicAnchor",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "generic, late-bound schemas have no counterpart in any target's type system",
        fix: "declare the schema in the 'schemas' catalogue and reference it by name",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$vocabulary",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "the vocabulary is fixed",
        fix: "remove '$vocabulary'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$comment",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "YAML comments serve; a '$comment' would reach no output",
        fix: "write a YAML comment ('# ...') or a 'description'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "$defs",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "named schemas live in the 'schemas' catalogue, one place",
        fix: "move each definition into the 'schemas' catalogue and reference it by name",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "allOf",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "every member is an object schema, merged into one object by the compiler",
        fix: "list object schemas only",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "anyOf",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "an untagged union cannot be decoded by a client without trying each branch, and validators disagree on overlaps",
        fix: "use 'oneOf' with a 'discriminator', 'nullable: true', or an opaque value with its reason",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "oneOf",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 3",
        reason: "tagged only: a mapping from tag value to variant, with a discriminator",
        fix: "write 'oneOf' as a mapping from tag to variant beside 'discriminator'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "not",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "negative constraints have no native form in Bean Validation, Laravel or Symfony constraints",
        fix: "state the accepted values positively (an enum, a pattern, a range)",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "if",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "conditional validation is not portable and hides two types in one",
        fix: "use a tagged union ('oneOf' with a 'discriminator')",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "then",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "conditional validation is not portable and hides two types in one",
        fix: "use a tagged union ('oneOf' with a 'discriminator')",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "else",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "conditional validation is not portable and hides two types in one",
        fix: "use a tagged union ('oneOf' with a 'discriminator')",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "dependentSchemas",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "conditional validation is not portable and hides two types in one",
        fix: "use a tagged union ('oneOf' with a 'discriminator')",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "prefixItems",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "tuples map to no record or class type",
        fix: "use an object, or an opaque value with its reason for a third party's tuple",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "items",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "an array has exactly one item schema",
        fix: "write one schema under 'items'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "contains",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "no native counterpart in most targets; no consumer",
        fix: "remove 'contains'; check the item schema with 'items'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "properties",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "patternProperties",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "key-dependent schemas map to no type",
        fix: "use a map: 'additionalProperties: <schema>' with 'propertyNames'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "additionalProperties",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "map form only: a map with string keys on an object without 'properties'",
        fix: "write 'additionalProperties: <schema>' on an object without 'properties'",
        refused_form: Some(RefusedForm {
            reason: "'true' and 'false' are refused because direction decides strictness",
            fix: "remove it, or set 'unknownKeys' on the input use (ADR 0003 section 4)",
        }),
    },
    SchemaKeyword {
        keyword: "propertyNames",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "map form only: the key schema of a map",
        fix: "write a string schema under 'propertyNames' beside 'additionalProperties'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "unevaluatedItems",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "direction decides how unknown fields are treated",
        fix: "remove it; input refuses unknown items and output tolerates them",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "unevaluatedProperties",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "direction decides how unknown fields are treated",
        fix: "remove it, or set 'unknownKeys' on the input use (ADR 0003 section 4)",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "type",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "one value: string, integer, number, boolean, object or array",
        fix: "write one type",
        refused_form: Some(RefusedForm {
            reason: "'null' and type arrays are refused; nullability is 'nullable' (ADR 0003 section 5)",
            fix: "write one type and 'nullable: true'",
        }),
    },
    SchemaKeyword {
        keyword: "const",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "a one-value field is an enum or a union tag; keeping both would give two ways to state it",
        fix: "use a catalogue enum, or a union tag",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "enum",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 7",
        reason: "by reference: 'enum: <EnumName>' or a narrowing",
        fix: "write 'enum: <EnumName>' or 'enum: { narrow, to }'",
        refused_form: Some(RefusedForm {
            reason: "inline value lists are refused because enums live in one catalogue, where each is declared once with its values, source and fallback",
            fix: "declare the values in the 'enums' catalogue and write 'enum: <EnumName>'",
        }),
    },
    SchemaKeyword {
        keyword: "multipleOf",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "on integer and decimal",
        fix: "use it on an integer or a decimal",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "maximum",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "exclusiveMaximum",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "minimum",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "exclusiveMinimum",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "maxLength",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "minLength",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "pattern",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 9",
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "maxItems",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "minItems",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "uniqueItems",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "no native, exact check in Bean Validation or class-validator, and \"equal\" differs for objects; no consumer",
        fix: "remove 'uniqueItems'; the handler deduplicates",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "maxContains",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "'contains' is refused",
        fix: "remove 'maxContains'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "minContains",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "'contains' is refused",
        fix: "remove 'minContains'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "maxProperties",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "no consumer; map size limits wait for one",
        fix: "remove 'maxProperties'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "minProperties",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "no consumer; map size limits wait for one",
        fix: "remove 'minProperties'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "required",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 5",
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "dependentRequired",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "conditional presence",
        fix: "use a tagged union ('oneOf' with a 'discriminator')",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "format",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 8",
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "contentMediaType",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "on a string field of a form or multipart input only, with 'application/json'",
        fix: "write 'contentMediaType: application/json' with 'contentSchema'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "contentSchema",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "the schema of a JSON text field",
        fix: "write it beside 'contentMediaType: application/json'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "contentEncoding",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "base64 inside JSON has no consumer; files travel as multipart parts or downloads",
        fix: "use a file field of a multipart input, or a file download",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "title",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "description",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "default",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 10",
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "deprecated",
        decision: SchemaKeywordDecision::Kept,
        section: SECTION_1,
        reason: "",
        fix: "",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "readOnly",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "they make one schema stand for two types; a payload that differs between input and output is two schemas",
        fix: "declare two schemas, the input one derived with 'pick' or 'omit'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "writeOnly",
        decision: SchemaKeywordDecision::Refused,
        section: SECTION_1,
        reason: "they make one schema stand for two types; a payload that differs between input and output is two schemas",
        fix: "declare two schemas, the input one derived with 'pick' or 'omit'",
        refused_form: None,
    },
    SchemaKeyword {
        keyword: "examples",
        decision: SchemaKeywordDecision::Kept,
        section: "ADR 0003 section 11",
        reason: "",
        fix: "",
        refused_form: None,
    },
];

/// The decision on `keyword`, or `None` for a word outside the 2020-12 vocabularies.
#[must_use]
pub fn schema_keyword(keyword: &str) -> Option<&'static SchemaKeyword> {
    SCHEMA_KEYWORDS
        .iter()
        .find(|schema_keyword| schema_keyword.keyword == keyword)
}

/// The refused keywords, in table order.
pub fn refused_schema_keywords() -> impl Iterator<Item = &'static SchemaKeyword> {
    SCHEMA_KEYWORDS
        .iter()
        .filter(|schema_keyword| schema_keyword.decision == SchemaKeywordDecision::Refused)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_refused_keyword_has_its_reason_and_fix() {
        for refused in refused_schema_keywords() {
            assert!(!refused.reason.is_empty(), "{}", refused.keyword);
            assert!(!refused.fix.is_empty(), "{}", refused.keyword);
        }
    }

    #[test]
    fn keywords_are_distinct_and_found_by_name() {
        for (position, entry) in SCHEMA_KEYWORDS.iter().enumerate() {
            let first = SCHEMA_KEYWORDS
                .iter()
                .position(|other| other.keyword == entry.keyword);

            assert_eq!(first, Some(position), "{}", entry.keyword);
            assert_eq!(schema_keyword(entry.keyword), Some(entry));
        }

        assert_eq!(schema_keyword("nullable"), None);
        assert_eq!(schema_keyword("Type"), None);
    }

    #[test]
    fn a_refused_form_belongs_to_a_kept_keyword() {
        for entry in SCHEMA_KEYWORDS {
            if entry.refused_form.is_some() {
                assert_eq!(
                    entry.decision,
                    SchemaKeywordDecision::Kept,
                    "{}",
                    entry.keyword
                );
            }
        }
    }
}
