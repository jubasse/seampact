//! Example values parsed against a type use with the strict input rules: unknown keys, unknown enum
//! members and union tags, a missing required property and a value outside a refinement are refused.
//! `int64` is read as a string, its default wire form; `email`, `uri` and `uri-reference` are checked
//! as strings only.

use std::cmp::Ordering;

use indexmap::IndexMap;
use regress::Regex;
use seampact_diagnostics::{InternalError, quote, quote_text};
use seampact_ir::{
    ArrayTypeUse, Enum, EnumTypeUse, JsonContent, KnownTypeUseRef, MapSchema, ObjectSchema,
    Refinements, ScalarType, ScalarTypeUse, Schema, TypeUse, UnionSchema,
};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaExampleIssue};

use crate::compile::{TreeSchemasExampleCheck, TreeSchemasWrittenValue};
use crate::decimal::{TreeSchemasDecimal, TreeSchemasDecimalSource, tree_schemas_decimal_of};
use crate::not_ported::not_ported_yet;
use crate::raw::{TreeSchemasProblem, TreeSchemasReporter};
use crate::rule::TreeSchemasRule;
use crate::scalars::MAX_SAFE_INTEGER;

/// ECMAScript source of an RFC 4122 shaped uuid text.
const UUID: &str = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
/// ECMAScript source of a `YYYY-MM-DD` text.
const DATE: &str = r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$";
/// ECMAScript source of an RFC 3339 date-time text.
const DATE_TIME: &str = r"^([0-9]{4}-[0-9]{2}-[0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$";
/// ECMAScript source of an int64 text.
const INT64: &str = r"^-?(0|[1-9][0-9]*)$";
/// ECMAScript source of a JSON number text.
const NUMBER_TEXT: &str = r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$";
const INT64_MIN: i64 = i64::MIN;
const INT64_MAX: i64 = i64::MAX;
const HOURS: u32 = 24;
const MINUTES: u32 = 60;

/// One bound of a refinement: the check its comparison must pass, and how a message names it.
#[derive(Debug, Clone, Copy)]
struct BoundCheck {
    key: &'static str,
    holds: fn(Ordering) -> bool,
    phrase: &'static str,
}

const BOUND_CHECKS: [BoundCheck; 4] = [
    BoundCheck {
        key: "minimum",
        holds: Ordering::is_ge,
        phrase: "at least",
    },
    BoundCheck {
        key: "exclusiveMinimum",
        holds: Ordering::is_gt,
        phrase: "above",
    },
    BoundCheck {
        key: "maximum",
        holds: Ordering::is_le,
        phrase: "at most",
    },
    BoundCheck {
        key: "exclusiveMaximum",
        holds: Ordering::is_lt,
        phrase: "below",
    },
];

/// A text read by its wire form: the value it stands for, or why it stands for none.
#[derive(Debug, Clone, PartialEq)]
enum TextReading {
    Value(JsonValue),
    Problem(String),
}

/// A format check over a text.
type FormatCheck = fn(&str) -> Result<bool, PassError>;

/// The checks of the formats the checker reads by text, keyed by format name.
const FORMAT_CHECKS: [(&str, FormatCheck); 5] = [
    ("uuid", format_check_uuid),
    ("date", is_calendar_date),
    ("date-time", is_date_time),
    ("decimal", format_check_decimal),
    ("int64", format_check_int64),
];

/// The rule a problem of a written value is reported under.
fn written_rule(written: TreeSchemasWrittenValue) -> TreeSchemasRule {
    match written {
        TreeSchemasWrittenValue::Example => TreeSchemasRule::ExampleValue,
        TreeSchemasWrittenValue::Default => TreeSchemasRule::DefaultValue,
        TreeSchemasWrittenValue::Extension => TreeSchemasRule::ExtensionValue,
    }
}

/// How a message names the written value.
const fn written_name(written: TreeSchemasWrittenValue) -> &'static str {
    match written {
        TreeSchemasWrittenValue::Example => "example",
        TreeSchemasWrittenValue::Default => "default",
        TreeSchemasWrittenValue::Extension => "extension",
    }
}

fn written_fix(written: TreeSchemasWrittenValue) -> &'static str {
    match written {
        TreeSchemasWrittenValue::Example => {
            "correct the example, or the schema it is parsed against"
        }
        TreeSchemasWrittenValue::Default => {
            "correct the default, or the schema it is parsed against"
        }
        TreeSchemasWrittenValue::Extension => {
            "correct the value, or the schema its extension key declares"
        }
    }
}

fn issue_at(pointer: &str, message: String) -> TreeSchemaExampleIssue {
    TreeSchemaExampleIssue {
        pointer: pointer.to_owned(),
        message,
    }
}

/// Whether a use accepts JSON `null`.
fn is_nullable(known: &KnownTypeUseRef<'_>) -> bool {
    let nullable = match known {
        KnownTypeUseRef::Ref(used) => used.nullable,
        KnownTypeUseRef::Opaque(used) => used.nullable,
        KnownTypeUseRef::File(used) => used.nullable,
        KnownTypeUseRef::Enum(used) => used.nullable,
        KnownTypeUseRef::Scalar(used) => used.nullable,
        KnownTypeUseRef::Array(used) => used.nullable,
    };

    nullable == Some(true)
}

/// `new RegExp(source, "u").test(text)`: the normalised source was accepted by the pattern parser, so
/// a source the engine refuses is a bug.
fn pattern_matches(source: &str, text: &str) -> Result<bool, PassError> {
    let expression = Regex::with_flags(source, "u").map_err(|error| {
        PassError::from(InternalError::new(format!(
            "tree.schemas holds the pattern {source:?}, which its engine refuses: {error}"
        )))
    })?;

    Ok(expression.find(text).is_some())
}

fn is_record(value: &JsonValue) -> bool {
    matches!(value, JsonValue::Object(_))
}

fn is_calendar_date(text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isCalendarDate"))
}

fn is_date_time(text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("isDateTime"))
}

fn format_check_uuid(text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("FORMAT_CHECKS.uuid"))
}

/// A written integer without a leading zero: `0|[1-9][0-9]*`.
fn is_canonical_integer(text: &str) -> bool {
    text == "0"
        || text
            .strip_prefix(|lead: char| ('1'..='9').contains(&lead))
            .is_some_and(|rest| rest.chars().all(|digit| digit.is_ascii_digit()))
}

/// `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`.
#[expect(
    clippy::unnecessary_wraps,
    reason = "an entry of FORMAT_CHECKS, whose other entries are stubs until their brief"
)]
fn format_check_decimal(text: &str) -> Result<bool, PassError> {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = match unsigned.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (unsigned, None),
    };
    let fraction_is_digits = fraction.is_none_or(|digits| {
        !digits.is_empty() && digits.chars().all(|digit| digit.is_ascii_digit())
    });

    Ok(is_canonical_integer(whole) && fraction_is_digits)
}

fn format_check_int64(text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("FORMAT_CHECKS.int64"))
}

/// Checks values against type uses over the compiled schemas and enums, which it never changes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasExampleChecker {
    schemas: IndexMap<String, Schema>,
    enums: IndexMap<String, Enum>,
}

impl TreeSchemasExampleChecker {
    pub(crate) const fn new(
        schemas: IndexMap<String, Schema>,
        enums: IndexMap<String, Enum>,
    ) -> Self {
        Self { schemas, enums }
    }

    /// The issues of `value` against `schema_use`, each at its pointer inside the value; empty when
    /// it fits.
    pub(crate) fn check(
        &self,
        value: &JsonValue,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        let mut issues = Vec::new();

        self.check_use(value, schema_use, "", &mut issues)?;

        Ok(issues)
    }

    /// The issues of a value written as text, read by the wire form of `schema_use`.
    pub(crate) fn check_text(
        &self,
        text: &str,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.checkText"))
    }

    fn text_value(&self, text: &str, schema_use: &TypeUse) -> Result<TextReading, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.textValue"))
    }

    fn check_use(
        &self,
        value: &JsonValue,
        schema_use: &TypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        let known = KnownTypeUseRef::try_from(schema_use)?;

        if matches!(known, KnownTypeUseRef::Opaque(_)) {
            return Ok(());
        }

        if matches!(value, JsonValue::Null) {
            if !is_nullable(&known) {
                issues.push(issue_at(pointer, "the value may not be null".to_owned()));
            }

            return Ok(());
        }

        match known {
            KnownTypeUseRef::Opaque(_) => Ok(()),
            KnownTypeUseRef::Ref(reference) => {
                self.schema(value, reference.schema.as_str(), pointer, issues)
            }
            KnownTypeUseRef::File(_) => {
                // A file is not JSON: an example names or holds its content as text.
                if !matches!(value, JsonValue::String(_)) {
                    issues.push(issue_at(pointer, "a file example is a string".to_owned()));
                }

                Ok(())
            }
            KnownTypeUseRef::Enum(enum_use) => self.enum_value(value, enum_use, pointer, issues),
            KnownTypeUseRef::Array(array_use) => self.array(value, array_use, pointer, issues),
            KnownTypeUseRef::Scalar(scalar_use) => self.scalar(value, scalar_use, pointer, issues),
        }
    }

    fn schema(
        &self,
        value: &JsonValue,
        id: &str,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.schema"))
    }

    fn object(
        &self,
        value: &JsonValue,
        schema: &ObjectSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
        tag_property: Option<&str>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.object"))
    }

    fn map(
        &self,
        value: &JsonValue,
        schema: &MapSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.map"))
    }

    fn union(
        &self,
        value: &JsonValue,
        schema: &UnionSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.union"))
    }

    fn enum_value(
        &self,
        value: &JsonValue,
        enum_use: &EnumTypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.enumValue"))
    }

    fn array(
        &self,
        value: &JsonValue,
        array_use: &ArrayTypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.array"))
    }

    fn scalar(
        &self,
        value: &JsonValue,
        scalar_use: &ScalarTypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        if let Some(problem) = self.scalar_problem(value, scalar_use)? {
            issues.push(issue_at(pointer, problem));

            return Ok(());
        }

        if let (Some(content), JsonValue::String(text)) = (&scalar_use.content, value) {
            self.content(text, content, pointer, issues)?;
        }

        Ok(())
    }

    fn scalar_problem(
        &self,
        value: &JsonValue,
        scalar_use: &ScalarTypeUse,
    ) -> Result<Option<String>, PassError> {
        let is_int64 = scalar_use.format.as_deref() == Some("int64");

        if scalar_use.r#type == ScalarType::String || is_int64 {
            let JsonValue::String(text) = value else {
                let note = if is_int64 {
                    " (an int64 is sent as a string)"
                } else {
                    ""
                };

                return Ok(Some(format!("{} is not a string{note}", quote(value))));
            };

            return self.string_problem(text, scalar_use);
        }

        if scalar_use.r#type == ScalarType::Boolean {
            return Ok(match value {
                JsonValue::Bool(_) => None,
                _ => Some(format!("{} is not a boolean", quote(value))),
            });
        }

        let JsonValue::Number(number) = value else {
            return Ok(Some(format!("{} is not a number", quote(value))));
        };
        let written = number.to_f64();
        let safe_integer = number.is_integer() && written.abs() <= MAX_SAFE_INTEGER;

        if scalar_use.r#type == ScalarType::Integer && !safe_integer {
            return Ok(Some(format!(
                "{} is not an integer in the safe range",
                quote(value)
            )));
        }

        self.bounds_problem(
            TreeSchemasDecimalSource::Number(written),
            &scalar_use.refinements,
        )
    }

    fn string_problem(
        &self,
        value: &str,
        scalar_use: &ScalarTypeUse,
    ) -> Result<Option<String>, PassError> {
        let format = scalar_use.format.as_deref();
        let format_check = format.and_then(|written| {
            FORMAT_CHECKS
                .iter()
                .find(|(name, _)| *name == written)
                .map(|(_, check)| check)
        });

        if let (Some(written), Some(check)) = (format, format_check)
            && !check(value)?
        {
            return Ok(Some(format!(
                "{} is not a valid {written}",
                quote_text(value)
            )));
        }

        let refinements = &scalar_use.refinements;
        let length = i64::try_from(value.chars().count()).map_err(|_| {
            PassError::from(InternalError::new(
                "tree.schemas holds an example text longer than a count of the IR".to_owned(),
            ))
        })?;

        if let Some(min_length) = refinements.min_length
            && length < min_length
        {
            return Ok(Some(format!(
                "{} is shorter than {min_length} characters",
                quote_text(value)
            )));
        }

        if let Some(max_length) = refinements.max_length
            && length > max_length
        {
            return Ok(Some(format!(
                "{} is longer than {max_length} characters",
                quote_text(value)
            )));
        }

        if let Some(pattern) = &refinements.pattern
            && !pattern_matches(&pattern.normalized, value)?
        {
            return Ok(Some(format!(
                "{} does not match the pattern {}",
                quote_text(value),
                quote_text(&pattern.source)
            )));
        }

        if matches!(format, Some("int64" | "decimal")) {
            return self.bounds_problem(TreeSchemasDecimalSource::Text(value), refinements);
        }

        Ok(None)
    }

    fn content(
        &self,
        value: &str,
        content: &JsonContent,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.content"))
    }

    fn bounds_problem(
        &self,
        value: TreeSchemasDecimalSource<'_>,
        refinements: &Refinements,
    ) -> Result<Option<String>, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.boundsProblem"))
    }
}

fn bound_of(literal: Option<&str>) -> Result<Option<TreeSchemasDecimal>, PassError> {
    let Some(literal) = literal else {
        return Ok(None);
    };

    tree_schemas_decimal_of(TreeSchemasDecimalSource::Text(literal))
}

/// Parses every example and default the run wrote against its use: each issue fails compilation at
/// its pointer inside the value, or at the deepest node of it the tree holds (a missing property is
/// reported at its object).
pub(crate) fn tree_schemas_check_written_examples(
    checks: &[TreeSchemasExampleCheck],
    checker: &TreeSchemasExampleChecker,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<(), PassError> {
    for check in checks {
        for issue in checker.check(&check.value, &check.schema_use)? {
            let inside = format!("{}{}", check.pointer, issue.pointer);
            let pointer = if reporter.resolves(&inside) {
                inside
            } else {
                check.pointer.clone()
            };

            reporter.error(TreeSchemasProblem {
                rule: written_rule(check.written),
                pointer,
                message: format!(
                    "the {} does not fit its schema at {}: {}",
                    written_name(check.written),
                    quote_text(&issue.pointer),
                    issue.message
                ),
                fix: written_fix(check.written).to_owned(),
                related: None,
            })?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pattern_matches_by_code_point_under_the_unicode_flag() {
        assert_eq!(pattern_matches("^.$", "\u{1F600}"), Ok(true));
        assert_eq!(pattern_matches("^.$", "ab"), Ok(false));
        assert!(pattern_matches("(", "a").is_err());
    }

    #[test]
    fn a_decimal_text_is_a_plain_integer_part_and_an_optional_fraction() {
        let cases = [
            ("0", true),
            ("-0.5", true),
            ("1.50", true),
            ("10", true),
            ("01", false),
            ("1.", false),
            (".5", false),
            ("-", false),
            ("+1", false),
            ("1e3", false),
            ("\u{ff11}", false),
        ];

        for (text, expected) in cases {
            assert_eq!(format_check_decimal(text), Ok(expected), "text {text:?}");
        }
    }
}
