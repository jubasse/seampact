//! Example values parsed against a type use with the strict input rules: unknown keys, unknown enum
//! members and union tags, a missing required property and a value outside a refinement are refused.
//! `int64` is read as a string, its default wire form; `email`, `uri` and `uri-reference` are checked
//! as strings only.

use std::cmp::Ordering;

use indexmap::IndexMap;
use regress::Regex;
use seampact_diagnostics::{InternalError, quote, quote_text};
use seampact_ir::{
    ArrayTypeUse, DecimalLiteral, Enum, EnumTypeUse, JsonContent, KnownSchemaRef, KnownTypeUseRef,
    KnownUnionTagRef, MapSchema, ObjectSchema, RefTypeUse, Refinements, ScalarType, ScalarTypeUse,
    Schema, TypeUse, UnionSchema, is_ir_calendar_date,
};
use seampact_json::{JsonNumber, JsonValue};
use seampact_pipeline::{PassError, TreeSchemaExampleIssue};
use serde_json::error::Category;

use crate::compile::{TreeSchemasExampleCheck, TreeSchemasWrittenValue};
use crate::decimal::{
    TreeSchemasDecimal, TreeSchemasDecimalSource, tree_schemas_compare_decimals,
    tree_schemas_decimal_of, tree_schemas_is_multiple_of,
};
use crate::raw::{TreeSchemasProblem, TreeSchemasReporter, tree_schemas_pointer};
use crate::rule::TreeSchemasRule;
use crate::scalars::MAX_SAFE_INTEGER;

/// The hex digits of each hyphen-separated group of a uuid.
const UUID_GROUP_LENGTHS: [usize; 5] = [8, 4, 4, 4, 12];
const HOURS: u32 = 24;
const MINUTES: u32 = 60;
/// What V8 says of a JSON text that ends early.
const UNEXPECTED_END: &str = "Unexpected end of JSON input";
/// The length of `YYYY-MM-DD`.
const DATE_LENGTH: usize = 10;
/// The length of `HH:MM:SS`.
const CLOCK_LENGTH: usize = 8;
const TWO_DIGITS_LENGTH: usize = 2;
const MAX_FRACTION_DIGITS: usize = 9;

/// One bound of a refinement: the check its comparison must pass, and how a message names it.
#[derive(Debug, Clone, Copy)]
struct BoundCheck {
    literal: fn(&Refinements) -> Option<&DecimalLiteral>,
    holds: fn(Ordering) -> bool,
    phrase: &'static str,
}

const BOUND_CHECKS: [BoundCheck; 4] = [
    BoundCheck {
        literal: |refinements| refinements.minimum.as_ref(),
        holds: Ordering::is_ge,
        phrase: "at least",
    },
    BoundCheck {
        literal: |refinements| refinements.exclusive_minimum.as_ref(),
        holds: Ordering::is_gt,
        phrase: "above",
    },
    BoundCheck {
        literal: |refinements| refinements.maximum.as_ref(),
        holds: Ordering::is_le,
        phrase: "at most",
    },
    BoundCheck {
        literal: |refinements| refinements.exclusive_maximum.as_ref(),
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
type FormatCheck = fn(&str) -> bool;

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

/// `JSON.parse`: the value, or the reason it refuses. An early end reads as V8 words it; any other
/// refusal carries the parser's own text.
fn parse_json_text(text: &str) -> Result<JsonValue, String> {
    let parsed: serde_json::Value = serde_json::from_str(text).map_err(|error| {
        if error.classify() == Category::Eof {
            UNEXPECTED_END.to_owned()
        } else {
            error.to_string()
        }
    })?;

    JsonValue::try_from(parsed).map_err(|error| error.to_string())
}

fn string_reading(text: &str) -> TextReading {
    TextReading::Value(JsonValue::String(text.to_owned()))
}

fn no_text_form(kind: &str) -> TextReading {
    TextReading::Problem(format!("this {kind} use has no text form"))
}

/// `^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`.
fn is_number_text(text: &str) -> bool {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let whole_length = unsigned
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(unsigned.len());
    let (whole, after_whole) = unsigned.split_at(whole_length);

    if !is_canonical_integer(whole) {
        return false;
    }

    let after_fraction = match after_whole.strip_prefix('.') {
        Some(rest) => match strip_digits(rest) {
            Some(after) => after,
            None => return false,
        },
        None => after_whole,
    };

    match after_fraction.strip_prefix(['e', 'E']) {
        Some(rest) => {
            let unsigned_exponent = rest.strip_prefix(['+', '-']).unwrap_or(rest);

            strip_digits(unsigned_exponent).is_some_and(str::is_empty)
        }
        None => after_fraction.is_empty(),
    }
}

/// What follows the leading run of ASCII digits, which holds at least one.
fn strip_digits(text: &str) -> Option<&str> {
    let rest = text.trim_start_matches(|character: char| character.is_ascii_digit());

    (rest.len() < text.len()).then_some(rest)
}

/// `YYYY-MM-DD` naming a day that exists. Year 0000 is a day here, as `Date.setUTCFullYear` reads
/// it, where the IR check starts at year 1; it is a leap year, like 2000.
fn is_calendar_date(text: &str) -> bool {
    match text.strip_prefix("0000-") {
        Some(rest) => is_ir_calendar_date(&format!("2000-{rest}")),
        None => is_ir_calendar_date(text),
    }
}

/// The value of a text of exactly two ASCII digits.
fn two_digits(text: &str) -> Option<u32> {
    if text.len() != TWO_DIGITS_LENGTH {
        return None;
    }

    text.chars()
        .try_fold(0_u32, |value, digit| Some(value * 10 + digit.to_digit(10)?))
}

/// The text after an optional fraction `.d{1,9}`, or `None` when a fraction is malformed.
fn after_fraction(text: &str) -> Option<&str> {
    let Some(digits_and_rest) = text.strip_prefix('.') else {
        return Some(text);
    };
    let digits = digits_and_rest
        .find(|digit: char| !digit.is_ascii_digit())
        .unwrap_or(digits_and_rest.len());

    if !(1..=MAX_FRACTION_DIGITS).contains(&digits) {
        return None;
    }

    digits_and_rest.get(digits..)
}

/// RFC 3339 `date-time` as ADR 0003 section 8 reads it: an offset is required, a leap second
/// refused.
fn is_date_time(text: &str) -> bool {
    if !text.is_ascii() {
        return false;
    }

    let Some((date, after_date)) = text.split_at_checked(DATE_LENGTH) else {
        return false;
    };
    let Some(clock_and_rest) = after_date.strip_prefix(['T', 't']) else {
        return false;
    };
    let Some((clock, after_clock)) = clock_and_rest.split_at_checked(CLOCK_LENGTH) else {
        return false;
    };
    let fields: Vec<Option<u32>> = clock.split(':').map(two_digits).collect();
    let [Some(hour), Some(minute), Some(second)] = fields[..] else {
        return false;
    };
    let Some(zone) = after_fraction(after_clock) else {
        return false;
    };
    let offset_in_range = match zone {
        "Z" | "z" => true,
        _ => zone
            .strip_prefix(['+', '-'])
            .and_then(|offset| offset.split_once(':'))
            .and_then(|(offset_hour, offset_minute)| {
                Some((two_digits(offset_hour)?, two_digits(offset_minute)?))
            })
            .is_some_and(|(offset_hour, offset_minute)| {
                offset_hour < HOURS && offset_minute < MINUTES
            }),
    };

    is_calendar_date(date)
        && hour < HOURS
        && minute < MINUTES
        && second < MINUTES
        && offset_in_range
}

/// `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`.
fn format_check_uuid(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();

    groups.len() == UUID_GROUP_LENGTHS.len()
        && groups
            .iter()
            .zip(UUID_GROUP_LENGTHS)
            .all(|(group, length)| {
                group.len() == length && group.chars().all(|digit| digit.is_ascii_hexdigit())
            })
}

/// A written integer without a leading zero: `0|[1-9][0-9]*`.
fn is_canonical_integer(text: &str) -> bool {
    text == "0"
        || text
            .strip_prefix(|lead: char| ('1'..='9').contains(&lead))
            .is_some_and(|rest| rest.chars().all(|digit| digit.is_ascii_digit()))
}

/// `^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`.
fn format_check_decimal(text: &str) -> bool {
    let unsigned = text.strip_prefix('-').unwrap_or(text);
    let (whole, fraction) = match unsigned.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (unsigned, None),
    };
    let fraction_is_digits = fraction.is_none_or(|digits| {
        !digits.is_empty() && digits.chars().all(|digit| digit.is_ascii_digit())
    });

    is_canonical_integer(whole) && fraction_is_digits
}

/// `^-?(0|[1-9][0-9]*)$` within the range of a signed 64-bit integer.
fn format_check_int64(text: &str) -> bool {
    let unsigned = text.strip_prefix('-').unwrap_or(text);

    is_canonical_integer(unsigned) && text.parse::<i64>().is_ok()
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
        match Self::text_value(text, schema_use)? {
            TextReading::Problem(message) => Ok(vec![issue_at("", message)]),
            TextReading::Value(value) => self.check(&value, schema_use),
        }
    }

    fn text_value(text: &str, schema_use: &TypeUse) -> Result<TextReading, PassError> {
        let scalar = match KnownTypeUseRef::try_from(schema_use)? {
            KnownTypeUseRef::Enum(_) => return Ok(string_reading(text)),
            KnownTypeUseRef::Scalar(scalar) => scalar,
            KnownTypeUseRef::Ref(_) => return Ok(no_text_form("ref")),
            KnownTypeUseRef::Opaque(_) => return Ok(no_text_form("opaque")),
            KnownTypeUseRef::File(_) => return Ok(no_text_form("file")),
            KnownTypeUseRef::Array(_) => return Ok(no_text_form("array")),
        };

        if scalar.r#type == ScalarType::String || scalar.format.as_deref() == Some("int64") {
            return Ok(string_reading(text));
        }

        if scalar.r#type == ScalarType::Boolean {
            return Ok(match text {
                "true" => TextReading::Value(JsonValue::Bool(true)),
                "false" => TextReading::Value(JsonValue::Bool(false)),
                _ => TextReading::Problem(format!("{} is not 'true' or 'false'", quote_text(text))),
            });
        }

        if !is_number_text(text) {
            return Ok(TextReading::Problem(format!(
                "{} is not a number",
                quote_text(text)
            )));
        }

        let number = text.parse::<f64>().ok().and_then(JsonNumber::from_f64);

        Ok(match number {
            Some(number) => TextReading::Value(JsonValue::Number(number)),
            None => TextReading::Problem(format!(
                "{} is past the range of a JSON number",
                quote_text(text)
            )),
        })
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
        let Some(schema) = self.schemas.get(id) else {
            return Err(PassError::from(InternalError::new(format!(
                "tree.schemas checks an example against no schema '{id}'"
            ))));
        };

        match KnownSchemaRef::try_from(schema)? {
            KnownSchemaRef::Object(object) => self.object(value, object, pointer, issues, None),
            KnownSchemaRef::Map(map) => self.map(value, map, pointer, issues),
            KnownSchemaRef::Union(union) => self.union(value, union, pointer, issues),
        }
    }

    fn object(
        &self,
        value: &JsonValue,
        schema: &ObjectSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
        tag_property: Option<&str>,
    ) -> Result<(), PassError> {
        let JsonValue::Object(object) = value else {
            issues.push(issue_at(
                pointer,
                format!("the value is not an object ({})", schema.id),
            ));

            return Ok(());
        };

        for key in object.keys() {
            let is_property = schema
                .properties
                .iter()
                .any(|property| property.name == *key);

            if tag_property != Some(key.as_str()) && !is_property {
                issues.push(issue_at(
                    &tree_schemas_pointer(pointer, &[key]),
                    format!("{} is not a property of {}", quote_text(key), schema.id),
                ));
            }
        }

        for property in &schema.properties {
            let Some(field) = object.get(&property.name) else {
                if !property.optional {
                    issues.push(issue_at(
                        pointer,
                        format!(
                            "the required property {} is missing",
                            quote_text(&property.name)
                        ),
                    ));
                }

                continue;
            };

            if matches!(field, JsonValue::Null) && property.nullable {
                continue;
            }

            let at = tree_schemas_pointer(pointer, &[&property.name]);

            self.check_use(field, &property.r#type, &at, issues)?;
        }

        Ok(())
    }

    fn map(
        &self,
        value: &JsonValue,
        schema: &MapSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        let JsonValue::Object(object) = value else {
            issues.push(issue_at(
                pointer,
                format!("the value is not an object ({})", schema.id),
            ));

            return Ok(());
        };

        for (key, entry) in object {
            let at = tree_schemas_pointer(pointer, &[key]);

            if let Some(keys) = &schema.keys {
                let key_value = JsonValue::String(key.clone());

                for issue in self.check(&key_value, keys)? {
                    issues.push(issue_at(
                        &at,
                        format!(
                            "the key {} does not fit: {}",
                            quote_text(key),
                            issue.message
                        ),
                    ));
                }
            }

            self.check_use(entry, &schema.values, &at, issues)?;
        }

        Ok(())
    }

    fn union(
        &self,
        value: &JsonValue,
        schema: &UnionSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        let property = match KnownUnionTagRef::try_from(&schema.tag)? {
            KnownUnionTagRef::Header(_) => {
                return self.header_union(value, schema, pointer, issues);
            }
            KnownUnionTagRef::Body(body) => &body.property,
        };
        let tag = match value {
            JsonValue::Object(object) => match object.get(property) {
                Some(JsonValue::String(tag)) => Some(tag),
                _ => None,
            },
            _ => None,
        };
        let Some(tag) = tag else {
            issues.push(issue_at(
                pointer,
                format!(
                    "the value holds no tag {} of {}",
                    quote_text(property),
                    schema.id
                ),
            ));

            return Ok(());
        };
        let variant_schema = schema
            .variants
            .iter()
            .find(|candidate| candidate.tag == *tag)
            .and_then(|variant| self.schemas.get(variant.schema.as_str()));
        let object_schema = match variant_schema.map(KnownSchemaRef::try_from).transpose()? {
            Some(KnownSchemaRef::Object(object_schema)) => object_schema,
            Some(KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_)) | None => {
                issues.push(issue_at(
                    &tree_schemas_pointer(pointer, &[property]),
                    format!("{} is no tag of {}", quote_text(tag), schema.id),
                ));

                return Ok(());
            }
        };

        self.object(value, object_schema, pointer, issues, Some(property))
    }

    /// A header-tagged union reads its tag outside the value, so the value fits when it fits one
    /// variant.
    fn header_union(
        &self,
        value: &JsonValue,
        schema: &UnionSchema,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        let mut fits = false;

        for variant in &schema.variants {
            let variant_use = TypeUse::Ref(RefTypeUse {
                schema: variant.schema.clone(),
                unknown_keys: None,
                nullable: None,
                docs: None,
                examples: None,
            });

            if self.check(value, &variant_use)?.is_empty() {
                fits = true;

                break;
            }
        }

        if !fits {
            issues.push(issue_at(
                pointer,
                format!("the value fits no variant of {}", schema.id),
            ));
        }

        Ok(())
    }

    fn enum_value(
        &self,
        value: &JsonValue,
        enum_use: &EnumTypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        let values = match &enum_use.narrowed_to {
            Some(narrowing) => Some(&narrowing.values),
            None => self
                .enums
                .get(enum_use.r#enum.as_str())
                .map(|declared| &declared.values),
        };
        let Some(values) = values else {
            return Err(PassError::from(InternalError::new(format!(
                "tree.schemas checks an example against no enum '{}'",
                enum_use.r#enum
            ))));
        };
        let is_value = matches!(value, JsonValue::String(text) if values.contains(text));

        if !is_value {
            issues.push(issue_at(
                pointer,
                format!("{} is not a value of {}", quote(value), enum_use.r#enum),
            ));
        }

        Ok(())
    }

    fn array(
        &self,
        value: &JsonValue,
        array_use: &ArrayTypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        let JsonValue::Array(items) = value else {
            issues.push(issue_at(pointer, "the value is not an array".to_owned()));

            return Ok(());
        };
        let length = i64::try_from(items.len()).map_err(|_| {
            PassError::from(InternalError::new(
                "tree.schemas holds an example array longer than a count of the IR".to_owned(),
            ))
        })?;

        if let Some(min_items) = array_use.min_items
            && length < min_items
        {
            issues.push(issue_at(
                pointer,
                format!("the array holds fewer than {min_items} items"),
            ));
        }

        if let Some(max_items) = array_use.max_items
            && length > max_items
        {
            issues.push(issue_at(
                pointer,
                format!("the array holds more than {max_items} items"),
            ));
        }

        for (index, item) in items.iter().enumerate() {
            let at = tree_schemas_pointer(pointer, &[&index.to_string()]);

            self.check_use(item, &array_use.items, &at, issues)?;
        }

        Ok(())
    }

    fn scalar(
        &self,
        value: &JsonValue,
        scalar_use: &ScalarTypeUse,
        pointer: &str,
        issues: &mut Vec<TreeSchemaExampleIssue>,
    ) -> Result<(), PassError> {
        if let Some(problem) = Self::scalar_problem(value, scalar_use)? {
            issues.push(issue_at(pointer, problem));

            return Ok(());
        }

        if let (Some(content), JsonValue::String(text)) = (&scalar_use.content, value) {
            self.content(text, content, pointer, issues)?;
        }

        Ok(())
    }

    fn scalar_problem(
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

            return Self::string_problem(text, scalar_use);
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

        Self::bounds_problem(
            TreeSchemasDecimalSource::Number(written),
            &scalar_use.refinements,
        )
    }

    fn string_problem(
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
            && !check(value)
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
            return Self::bounds_problem(TreeSchemasDecimalSource::Text(value), refinements);
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
        let parsed = match parse_json_text(value) {
            Ok(parsed) => parsed,
            Err(reason) => {
                issues.push(issue_at(
                    pointer,
                    format!("the value is not JSON text: {reason}"),
                ));

                return Ok(());
            }
        };

        for issue in self.check(&parsed, &content.schema)? {
            issues.push(issue_at(
                pointer,
                format!(
                    "the JSON text does not fit at {}: {}",
                    quote_text(&issue.pointer),
                    issue.message
                ),
            ));
        }

        Ok(())
    }

    fn bounds_problem(
        value: TreeSchemasDecimalSource<'_>,
        refinements: &Refinements,
    ) -> Result<Option<String>, PassError> {
        let Some(decimal) = tree_schemas_decimal_of(value)? else {
            return Ok(Some(format!(
                "{} is not a decimal number",
                quoted_source(&value)
            )));
        };

        for check in BOUND_CHECKS {
            let Some(literal) = (check.literal)(refinements) else {
                continue;
            };
            let Some(bound) = bound_of(Some(literal.as_str()))? else {
                continue;
            };

            if !(check.holds)(tree_schemas_compare_decimals(&decimal, &bound)?) {
                return Ok(Some(format!(
                    "{} is not {} {literal}",
                    quoted_source(&value),
                    check.phrase
                )));
            }
        }

        let Some(step_literal) = &refinements.multiple_of else {
            return Ok(None);
        };

        if let Some(step) = bound_of(Some(step_literal.as_str()))?
            && !tree_schemas_is_multiple_of(&decimal, &step)?
        {
            return Ok(Some(format!(
                "{} is not a multiple of {step_literal}",
                quoted_source(&value)
            )));
        }

        Ok(None)
    }
}

/// `quote` of the number or text a bound is checked on.
fn quoted_source(value: &TreeSchemasDecimalSource<'_>) -> String {
    match value {
        TreeSchemasDecimalSource::Text(text) => quote_text(text),
        TreeSchemasDecimalSource::Number(number) => match JsonNumber::from_f64(*number) {
            Some(finite) => quote(&JsonValue::Number(finite)),
            None => "null".to_owned(),
        },
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
    fn a_calendar_date_names_a_day_that_exists_and_year_zero_is_a_leap_year() {
        let cases = [
            ("0000-02-29", true),
            ("2024-02-29", true),
            ("2000-02-29", true),
            ("1900-02-29", false),
            ("2026-02-29", false),
            ("2026-13-01", false),
            ("2026-1-01", false),
            ("\u{ff12}026-01-01", false),
        ];

        for (text, expected) in cases {
            assert_eq!(is_calendar_date(text), expected, "text {text:?}");
        }
    }

    #[test]
    fn a_date_time_needs_an_offset_and_refuses_a_leap_second() {
        let cases = [
            ("2026-01-01T00:00:00Z", true),
            ("2026-01-01t23:59:59.123456789+23:59", true),
            ("2026-01-01T00:00:60Z", false),
            ("2026-01-01T24:00:00Z", false),
            ("2026-01-01T00:00:00", false),
            ("2026-01-01T00:00:00.Z", false),
            ("2026-01-01T00:00:00.1234567890Z", false),
            ("2026-01-01T00:00:00+24:00", false),
            ("2026-01-01T00:00:00+00:60", false),
            ("2026-01-01T00:00:00+0000", false),
            ("2026-02-30T00:00:00Z", false),
            ("2026-01-01T00:00:00Z ", false),
        ];

        for (text, expected) in cases {
            assert_eq!(is_date_time(text), expected, "text {text:?}");
        }
    }

    #[test]
    fn an_int64_text_stays_within_the_signed_64_bit_range() {
        let cases = [
            ("9223372036854775807", true),
            ("9223372036854775808", false),
            ("-9223372036854775808", true),
            ("-9223372036854775809", false),
            ("-0", true),
            ("00", false),
            ("-", false),
            ("", false),
        ];

        for (text, expected) in cases {
            assert_eq!(format_check_int64(text), expected, "text {text:?}");
        }
    }

    #[test]
    fn a_json_text_that_ends_early_reads_as_v8_words_it() {
        assert_eq!(parse_json_text("[1,2"), Err(UNEXPECTED_END.to_owned()));
        assert_eq!(parse_json_text(""), Err(UNEXPECTED_END.to_owned()));
        assert!(parse_json_text("nope").is_err());
        assert!(parse_json_text(r#"{"a":1}"#).is_ok());
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
            assert_eq!(format_check_decimal(text), expected, "text {text:?}");
        }
    }
}
