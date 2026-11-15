//! Scalars, formats and refinements: the portable formats, the named formats of the `scalars`
//! catalogue, and refinements with numeric bounds as decimal literal strings.

use std::cmp::Ordering;

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    DecimalLiteral, Docs, Name as IrName, NameRole, Refinements, Scalar, ScalarId, ScalarType,
    ScalarTypeUse,
};
use seampact_js::FiniteNumber;
use seampact_json::{JsonNumber, JsonObject, JsonValue};
use seampact_naming::split_name;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::raw::{
    TreeSchemasProblem, TreeSchemasReporter, tree_schemas_entries, tree_schemas_member,
    tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;

/// The portable formats, each with the type it is written beside.
const PORTABLE_FORMATS: [(&str, ScalarType); 8] = [
    ("uuid", ScalarType::String),
    ("date-time", ScalarType::String),
    ("date", ScalarType::String),
    ("int64", ScalarType::Integer),
    ("decimal", ScalarType::String),
    ("email", ScalarType::String),
    ("uri", ScalarType::String),
    ("uri-reference", ScalarType::String),
];

/// What `sensitive` emits; never written as a format or a named format.
const PASSWORD: &str = "password";
const DECIMAL: &str = "decimal";

const LENGTHS: [&str; 2] = ["minLength", "maxLength"];
const BOUNDS: [&str; 4] = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];
const LOWER_BOUNDS: [&str; 2] = ["minimum", "exclusiveMinimum"];
const UPPER_BOUNDS: [&str; 2] = ["maximum", "exclusiveMaximum"];

/// A double holds 15 to 17 significant digits: a fraction whose shortest form takes 17 was written
/// with digits the loaded number may no longer hold.
const MAX_FRACTION_DIGITS: usize = 16;

/// A written bound: the refinement key and its decimal literal.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Bound {
    key: &'static str,
    literal: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RefinementTarget {
    scalar_type: ScalarType,
    /// A `decimal` string, which takes the numeric refinements.
    decimal: bool,
}

fn portable_type_of(format: &str) -> Option<ScalarType> {
    PORTABLE_FORMATS
        .iter()
        .find(|(portable, _)| *portable == format)
        .map(|(_, scalar_type)| scalar_type.clone())
}

/// The largest magnitude `Number.isSafeInteger` accepts, 2^53 - 1.
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

/// A number as the decimal literal string of its loaded value: `None` for an integer beyond the
/// safe range or a fraction whose shortest form takes more than 16 significant digits. Only the
/// loaded number is checked: digits the loader already rounded away are not seen here.
fn tree_schemas_decimal_literal(value: f64) -> Option<String> {
    let number = FiniteNumber::new(value)?;

    if number.is_integer() {
        return (value.abs() <= MAX_SAFE_INTEGER).then(|| number.to_string());
    }

    let literal = without_exponent(&number.to_string());

    (significant_digits(&literal) <= MAX_FRACTION_DIGITS).then_some(literal)
}

/// The parts of a number written with a negative exponent: `^(-?)([0-9])(?:\.([0-9]+))?e-([0-9]+)$`.
struct ExponentForm<'text> {
    sign: &'text str,
    lead: char,
    fraction: &'text str,
    shift: &'text str,
}

fn is_digits(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|digit| digit.is_ascii_digit())
}

fn exponent_form(text: &str) -> Option<ExponentForm<'_>> {
    let (mantissa, shift) = text.split_once("e-")?;
    let (sign, unsigned) = mantissa
        .strip_prefix('-')
        .map_or(("", mantissa), |rest| ("-", rest));
    let lead = unsigned.chars().next().filter(char::is_ascii_digit)?;
    let after_lead = unsigned.strip_prefix(lead)?;
    let fraction = match after_lead.strip_prefix('.') {
        Some(digits) if is_digits(digits) => digits,
        None if after_lead.is_empty() => "",
        Some(_) | None => return None,
    };

    is_digits(shift).then_some(ExponentForm {
        sign,
        lead,
        fraction,
        shift,
    })
}

/// A fraction's shortest form as plain digits: JavaScript writes one below 1e-6 with an exponent
/// (`1e-7`).
fn without_exponent(text: &str) -> String {
    let Some(form) = exponent_form(text) else {
        return text.to_owned();
    };
    let zeros = form
        .shift
        .parse::<usize>()
        .map_or(0, |count| count.saturating_sub(1));

    format!(
        "{}0.{}{}{}",
        form.sign,
        "0".repeat(zeros),
        form.lead,
        form.fraction
    )
}

fn significant_digits(literal: &str) -> usize {
    let unsigned = literal.replacen('-', "", 1).replacen('.', "", 1);

    unsigned.trim_start_matches('0').chars().count()
}

/// The text of a bound as the JavaScript number it reads as; NaN for text that is none.
fn bound_number(literal: &str) -> f64 {
    literal.parse::<f64>().unwrap_or(f64::NAN)
}

fn refinement_bound<'refinements>(
    refinements: &'refinements Refinements,
    key: &str,
) -> Option<&'refinements DecimalLiteral> {
    match key {
        "minimum" => refinements.minimum.as_ref(),
        "maximum" => refinements.maximum.as_ref(),
        "exclusiveMinimum" => refinements.exclusive_minimum.as_ref(),
        "exclusiveMaximum" => refinements.exclusive_maximum.as_ref(),
        "multipleOf" => refinements.multiple_of.as_ref(),
        _ => None,
    }
}

fn set_refinement_bound(
    refinements: &mut Refinements,
    key: &str,
    literal: String,
) -> Result<(), PassError> {
    let slot = match key {
        "minimum" => &mut refinements.minimum,
        "maximum" => &mut refinements.maximum,
        "exclusiveMinimum" => &mut refinements.exclusive_minimum,
        "exclusiveMaximum" => &mut refinements.exclusive_maximum,
        "multipleOf" => &mut refinements.multiple_of,
        _ => {
            return Err(InternalError::new(format!(
                "tree.schemas has no refinement '{key}' to bound"
            ))
            .into());
        }
    };

    *slot = Some(DecimalLiteral::new(literal));

    Ok(())
}

fn empty_refinements() -> Refinements {
    Refinements {
        min_length: None,
        max_length: None,
        pattern: None,
        minimum: None,
        maximum: None,
        exclusive_minimum: None,
        exclusive_maximum: None,
        multiple_of: None,
    }
}

/// The bounds no value fits between: a lower bound above an upper one, equal to it with either
/// exclusive, or, for an integer, no integer left between them.
fn empty_ranges(refinements: &Refinements, scalar_type: &ScalarType) -> Vec<String> {
    let mut problems = Vec::new();

    if let (Some(min), Some(max)) = (refinements.min_length, refinements.max_length)
        && min > max
    {
        problems.push(format!("'minLength' {min} is above 'maxLength' {max}"));
    }

    for lower_key in LOWER_BOUNDS {
        for upper_key in UPPER_BOUNDS {
            let (Some(lower), Some(upper)) = (
                refinement_bound(refinements, lower_key),
                refinement_bound(refinements, upper_key),
            ) else {
                continue;
            };
            let lower = Bound {
                key: lower_key,
                literal: lower.as_str().to_owned(),
            };
            let upper = Bound {
                key: upper_key,
                literal: upper.as_str().to_owned(),
            };

            if let Some(problem) = empty_between(&lower, &upper, scalar_type) {
                problems.push(problem);
            }
        }
    }

    problems
}

fn empty_between(lower: &Bound, upper: &Bound, scalar_type: &ScalarType) -> Option<String> {
    let lower_text = format!("'{}' {}", lower.key, lower.literal);
    let upper_text = format!("'{}' {}", upper.key, upper.literal);
    let exclusive = lower.key == "exclusiveMinimum" || upper.key == "exclusiveMaximum";
    let lower_value = bound_number(&lower.literal);
    let upper_value = bound_number(&upper.literal);

    if lower_value > upper_value {
        return Some(format!("{lower_text} is above {upper_text}"));
    }

    if lower_value.partial_cmp(&upper_value) == Some(Ordering::Equal) && exclusive {
        return Some(format!(
            "{lower_text} equals {upper_text}, one of them exclusive"
        ));
    }

    if *scalar_type == ScalarType::Integer && lowest_integer(lower) > highest_integer(upper) {
        return Some(format!(
            "no integer lies between {lower_text} and {upper_text}"
        ));
    }

    None
}

fn lowest_integer(bound: &Bound) -> f64 {
    let value = bound_number(&bound.literal);

    if bound.key == "minimum" {
        value.ceil()
    } else {
        value.floor() + 1.0
    }
}

fn highest_integer(bound: &Bound) -> f64 {
    let value = bound_number(&bound.literal);

    if bound.key == "maximum" {
        value.floor()
    } else {
        value.ceil() - 1.0
    }
}

/// Reports a refinement written where its type does not take it.
fn refuse_misplaced(
    key: &str,
    fix: Option<&str>,
    pointer: &str,
    target: &RefinementTarget,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<(), PassError> {
    let applies_to = if target.decimal {
        "a decimal".to_owned()
    } else {
        format!("a {}", target.scalar_type)
    };

    reporter.error(TreeSchemasProblem {
        rule: TreeSchemasRule::RefinementType,
        pointer: tree_schemas_pointer(pointer, &[key]),
        message: format!("'{key}' does not apply to {applies_to}"),
        fix: fix.map_or_else(|| format!("remove '{key}'"), str::to_owned),
        related: None,
    })
}

/// A written length: validate guarantees a non-negative integer.
fn written_count(written: &JsonNumber, key: &str, pointer: &str) -> Result<i64, PassError> {
    let value = written.to_f64();
    let within = written.is_integer() && value.abs() <= MAX_SAFE_INTEGER;

    if !within {
        return Err(InternalError::new(format!(
            "tree.schemas found the non-integer '{key}' at {pointer}, which validate guarantees is a count"
        ))
        .into());
    }

    // An integer within 2^53, so the cast is exact.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an integer within 2^53 in magnitude, so the cast is exact"
    )]
    Ok(value as i64)
}

/// The scalar uses of the api: plain scalars, portable formats and the named formats of `scalars`.
#[derive(Debug)]
pub(crate) struct TreeSchemasScalars<'raw> {
    catalogue: Option<&'raw JsonValue>,
    declarations: IndexMap<String, Option<Scalar>>,
}

impl<'raw> TreeSchemasScalars<'raw> {
    pub(crate) fn new(catalogue: Option<&'raw JsonValue>) -> Self {
        Self {
            catalogue,
            declarations: IndexMap::new(),
        }
    }

    /// Every named format of the `scalars` catalogue, in written order; a refused one is left out.
    pub(crate) fn all(
        &mut self,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Vec<Scalar>, PassError> {
        let catalogue = self.catalogue;
        let mut scalars = Vec::new();

        for (id, _) in tree_schemas_entries(catalogue) {
            if let Some(scalar) = self.declaration(id, reporter)? {
                scalars.push(scalar);
            }
        }

        Ok(scalars)
    }

    pub(crate) fn use_of(
        &mut self,
        value: &JsonObject,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<ScalarTypeUse>, PassError> {
        let format = match value.get("format") {
            Some(JsonValue::String(format)) => Some(format.as_str()),
            _ => None,
        };
        let scalar_type = match value.get("type") {
            Some(JsonValue::String(written)) => ScalarType::known(written),
            _ => None,
        };
        let Some(scalar_type) = scalar_type else {
            return match format {
                Some(format) => self.named_format_use(format, value, pointer, reporter),
                None => Ok(None),
            };
        };

        if let Some(format) = format
            && !self.check_format_beside_type(format, &scalar_type, pointer, reporter)?
        {
            return Ok(None);
        }

        let target = RefinementTarget {
            scalar_type: scalar_type.clone(),
            decimal: format == Some(DECIMAL),
        };
        let Some(refinements) = self.refinements(value, pointer, &target, reporter)? else {
            return Ok(None);
        };

        if !self.check_ranges(&refinements, &scalar_type, pointer, reporter)? {
            return Ok(None);
        }

        Ok(Some(ScalarTypeUse {
            r#type: scalar_type,
            format: format.map(str::to_owned),
            scalar: None,
            refinements,
            content: None,
            sensitive: None,
            nullable: None,
            docs: None,
            examples: None,
        }))
    }

    fn declaration(
        &mut self,
        id: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<Scalar>, PassError> {
        if let Some(declared) = self.declarations.get(id) {
            return Ok(declared.clone());
        }

        let pointer = tree_schemas_pointer("/scalars", &[id]);
        let scalar = match tree_schemas_member(self.catalogue, id) {
            Some(JsonValue::Object(value)) => {
                self.compile_declaration(id, value, &pointer, reporter)?
            }
            _ => None,
        };

        self.declarations.insert(id.to_owned(), scalar.clone());

        Ok(scalar)
    }

    fn compile_declaration(
        &mut self,
        id: &str,
        value: &JsonObject,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<Scalar>, PassError> {
        let portable = portable_type_of(id);

        if portable.is_some() || id == PASSWORD {
            let (taken, fix) = match &portable {
                Some(portable) => (
                    "a portable format".to_owned(),
                    format!(
                        "remove it and write 'type: {portable}, format: {id}' where it is used"
                    ),
                ),
                None => (
                    "what 'sensitive' emits".to_owned(),
                    "remove it and mark the field 'sensitive: true'".to_owned(),
                ),
            };

            reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::ScalarName,
                pointer: pointer.to_owned(),
                message: format!(
                    "the named format '{id}' takes the name of {taken}, so one name would mean two checks"
                ),
                fix,
                related: None,
            })?;

            return Ok(None);
        }

        let scalar_type = match value.get("type") {
            Some(JsonValue::String(written)) if written == "integer" => ScalarType::Integer,
            _ => ScalarType::String,
        };
        let target = RefinementTarget {
            scalar_type: scalar_type.clone(),
            decimal: false,
        };
        let Some(refinements) = self.refinements(value, pointer, &target, reporter)? else {
            return Ok(None);
        };

        if !self.check_ranges(&refinements, &scalar_type, pointer, reporter)? {
            return Ok(None);
        }

        Ok(Some(Scalar {
            id: ScalarId::new(id.to_owned()),
            name: IrName {
                segments: split_name(id),
                role: NameRole::Schema,
                status: None,
            },
            r#type: ScalarTypeUse {
                r#type: scalar_type,
                format: None,
                scalar: None,
                refinements,
                content: None,
                sensitive: None,
                nullable: None,
                docs: None,
                examples: None,
            },
            directions: Vec::new(),
            docs: tree_schemas_mapping_docs(value),
            origin: reporter.origin(pointer)?,
        }))
    }

    fn check_format_beside_type(
        &mut self,
        format: &str,
        scalar_type: &ScalarType,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        let portable = portable_type_of(format);

        if portable.as_ref() == Some(scalar_type) {
            return Ok(true);
        }

        let at = tree_schemas_pointer(pointer, &["format"]);

        if let Some(portable) = portable {
            reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::FormatType,
                pointer: at,
                message: format!(
                    "the portable format '{format}' is a {portable}, not a {scalar_type}"
                ),
                fix: format!("write 'type: {portable}, format: {format}'"),
                related: None,
            })?;
        } else if format == PASSWORD {
            self.password_format(&at, reporter)?;
        } else if self.declaration(format, reporter)?.is_some() {
            reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::FormatType,
                pointer: tree_schemas_pointer(pointer, &["type"]),
                message: format!("the named format '{format}' already states its type"),
                fix: format!("remove 'type' and write 'format: {format}' alone"),
                related: None,
            })?;
        } else {
            self.unknown_format(format, &at, reporter)?;
        }

        Ok(false)
    }

    fn named_format_use(
        &mut self,
        format: &str,
        value: &JsonObject,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<ScalarTypeUse>, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.namedFormatUse"))
    }

    fn check_ranges(
        &self,
        refinements: &Refinements,
        scalar_type: &ScalarType,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        let empty = empty_ranges(refinements, scalar_type);

        for problem in &empty {
            reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::RefinementRange,
                pointer: pointer.to_owned(),
                message: format!("no value fits the schema: {problem}"),
                fix: "lower the minimum or raise the maximum".to_owned(),
                related: None,
            })?;
        }

        Ok(empty.is_empty())
    }

    fn password_format(
        &self,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasScalars.passwordFormat"))
    }

    fn unknown_format(
        &self,
        format: &str,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<(), PassError> {
        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::FormatUnknown,
            pointer: pointer.to_owned(),
            message: format!(
                "'{format}' is neither a portable format nor a named format of 'scalars'"
            ),
            fix: "declare it under 'scalars', or write a portable format".to_owned(),
            related: None,
        })
    }

    fn refinements(
        &self,
        value: &JsonObject,
        pointer: &str,
        target: &RefinementTarget,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<Refinements>, PassError> {
        let mut out = empty_refinements();
        let mut refused = false;
        let is_string = target.scalar_type == ScalarType::String;
        let is_numeric = matches!(target.scalar_type, ScalarType::Integer | ScalarType::Number)
            || target.decimal;

        for key in LENGTHS {
            let Some(JsonValue::Number(written)) = value.get(key) else {
                continue;
            };

            if !is_string || target.decimal {
                refuse_misplaced(key, None, pointer, target, reporter)?;
                refused = true;

                continue;
            }

            let length = Some(written_count(written, key, pointer)?);

            if key == "minLength" {
                out.min_length = length;
            } else {
                out.max_length = length;
            }
        }

        if let Some(JsonValue::String(source)) = value.get("pattern") {
            if !is_string || target.decimal {
                refuse_misplaced("pattern", None, pointer, target, reporter)?;
                refused = true;
            } else if !self.pattern(source, pointer, &mut out, reporter)? {
                refused = true;
            }
        }

        for key in BOUNDS.into_iter().chain(["multipleOf"]) {
            let Some(JsonValue::Number(bound)) = value.get(key) else {
                continue;
            };

            if !is_numeric {
                refuse_misplaced(key, None, pointer, target, reporter)?;
                refused = true;
            } else if key == "multipleOf" && target.scalar_type == ScalarType::Number {
                let fix =
                    "use 'type: integer', or 'type: string, format: decimal' for an exact step";

                refuse_misplaced(key, Some(fix), pointer, target, reporter)?;
                refused = true;
            } else if !self.bound(key, bound.to_f64(), pointer, &mut out, reporter)? {
                refused = true;
            }
        }

        Ok((!refused).then_some(out))
    }

    fn pattern(
        &self,
        source: &str,
        pointer: &str,
        out: &mut Refinements,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.pattern"))
    }

    fn bound(
        &self,
        key: &str,
        bound: f64,
        pointer: &str,
        out: &mut Refinements,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        if let Some(literal) = tree_schemas_decimal_literal(bound) {
            set_refinement_bound(out, key, literal)?;

            return Ok(true);
        }

        let integer = FiniteNumber::new(bound).is_some_and(FiniteNumber::is_integer);
        let message = if integer {
            format!(
                "'{key}' is an integer beyond the safe range, whose written digits the contract reader cannot keep"
            )
        } else {
            format!("'{key}' has more significant digits than the contract reader keeps")
        };
        let fix = if integer {
            "write a bound between -(2^53 - 1) and 2^53 - 1".to_owned()
        } else {
            format!("write the bound with at most {MAX_FRACTION_DIGITS} significant digits")
        };

        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::RefinementPrecision,
            pointer: tree_schemas_pointer(pointer, &[key]),
            message,
            fix,
            related: None,
        })?;

        Ok(false)
    }
}

/// The docs of a schema: its `title` as the summary, and its `description`.
pub(crate) fn tree_schemas_docs(value: Option<&JsonValue>) -> Docs {
    match value {
        Some(JsonValue::Object(mapping)) => tree_schemas_mapping_docs(mapping),
        _ => Docs::default(),
    }
}

/// The docs of a schema mapping.
pub(crate) fn tree_schemas_mapping_docs(value: &JsonObject) -> Docs {
    let written_text = |key: &str| match value.get(key) {
        Some(JsonValue::String(text)) => Some(text.clone()),
        _ => None,
    };

    Docs {
        summary: written_text("title"),
        description: written_text("description"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decimal_literal_is_the_shortest_plain_text_of_the_loaded_number() {
        let cases = [
            (0.1, Some("0.1")),
            (1e-7, Some("0.0000001")),
            (-1.5e-10, Some("-0.00000000015")),
            (-0.0, Some("0")),
            (9_007_199_254_740_991.0, Some("9007199254740991")),
            (9_007_199_254_740_992.0, None),
            (1e21, None),
            (0.1 + 0.2, None),
        ];

        for (number, expected) in cases {
            assert_eq!(
                tree_schemas_decimal_literal(number).as_deref(),
                expected,
                "number {number:?}"
            );
        }
    }

    #[test]
    fn a_range_is_empty_when_no_value_or_no_integer_fits_it() {
        let bounded = |minimum: Option<&str>,
                       maximum: Option<&str>,
                       exclusive_minimum: Option<&str>,
                       exclusive_maximum: Option<&str>| Refinements {
            minimum: minimum.map(|text| DecimalLiteral::new(text.to_owned())),
            maximum: maximum.map(|text| DecimalLiteral::new(text.to_owned())),
            exclusive_minimum: exclusive_minimum.map(|text| DecimalLiteral::new(text.to_owned())),
            exclusive_maximum: exclusive_maximum.map(|text| DecimalLiteral::new(text.to_owned())),
            ..empty_refinements()
        };

        assert_eq!(
            empty_ranges(
                &bounded(Some("2"), Some("1"), None, None),
                &ScalarType::Number
            ),
            ["'minimum' 2 is above 'maximum' 1"]
        );
        assert_eq!(
            empty_ranges(
                &bounded(Some("1"), None, None, Some("1")),
                &ScalarType::Number
            ),
            ["'minimum' 1 equals 'exclusiveMaximum' 1, one of them exclusive"]
        );
        assert_eq!(
            empty_ranges(
                &bounded(Some("0.5"), Some("0.9"), None, None),
                &ScalarType::Integer
            ),
            ["no integer lies between 'minimum' 0.5 and 'maximum' 0.9"]
        );
        assert_eq!(
            empty_ranges(
                &bounded(None, None, Some("1"), Some("2")),
                &ScalarType::Integer
            ),
            ["no integer lies between 'exclusiveMinimum' 1 and 'exclusiveMaximum' 2"]
        );
        assert_eq!(
            empty_ranges(
                &bounded(Some("0.5"), Some("0.9"), None, None),
                &ScalarType::Number
            ),
            Vec::<String>::new()
        );
    }
}
