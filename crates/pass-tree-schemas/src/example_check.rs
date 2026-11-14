//! Example values parsed against a type use with the strict input rules: unknown keys, unknown enum
//! members and union tags, a missing required property and a value outside a refinement are refused.
//! `int64` is read as a string, its default wire form; `email`, `uri` and `uri-reference` are checked
//! as strings only.

use std::cmp::Ordering;

use indexmap::IndexMap;
use seampact_ir::{
    ArrayTypeUse, Enum, EnumTypeUse, JsonContent, MapSchema, ObjectSchema, Refinements,
    ScalarTypeUse, Schema, TypeUse, UnionSchema,
};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaExampleIssue};

use crate::compile::{TreeSchemasExampleCheck, TreeSchemasWrittenValue};
use crate::decimal::{TreeSchemasDecimal, TreeSchemasDecimalSource};
use crate::not_ported::not_ported_yet;
use crate::raw::TreeSchemasReporter;

/// ECMAScript source of an RFC 4122 shaped uuid text.
const UUID: &str = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
/// ECMAScript source of a `YYYY-MM-DD` text.
const DATE: &str = r"^([0-9]{4})-([0-9]{2})-([0-9]{2})$";
/// ECMAScript source of an RFC 3339 date-time text.
const DATE_TIME: &str = r"^([0-9]{4}-[0-9]{2}-[0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$";
/// ECMAScript source of an int64 text.
const INT64: &str = r"^-?(0|[1-9][0-9]*)$";
/// ECMAScript source of a decimal text.
const DECIMAL: &str = r"^-?(0|[1-9][0-9]*)(\.[0-9]+)?$";
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
fn written_rule(written: TreeSchemasWrittenValue) -> &'static str {
    match written {
        TreeSchemasWrittenValue::Example => "example-value",
        TreeSchemasWrittenValue::Default => "default-value",
        TreeSchemasWrittenValue::Extension => "extension-value",
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

fn is_record(value: &JsonValue) -> Result<bool, PassError> {
    Err(not_ported_yet("isRecord"))
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

fn format_check_decimal(text: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("FORMAT_CHECKS.decimal"))
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
    pub(crate) fn new(
        schemas: IndexMap<String, Schema>,
        enums: IndexMap<String, Enum>,
    ) -> Result<Self, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.constructor"))
    }

    /// The issues of `value` against `schema_use`, each at its pointer inside the value; empty when
    /// it fits.
    pub(crate) fn check(
        &self,
        value: &JsonValue,
        schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.check"))
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
        Err(not_ported_yet("TreeSchemasExampleChecker.use"))
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
        Err(not_ported_yet("TreeSchemasExampleChecker.scalar"))
    }

    fn scalar_problem(
        &self,
        value: &JsonValue,
        scalar_use: &ScalarTypeUse,
    ) -> Result<Option<String>, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.scalarProblem"))
    }

    fn string_problem(
        &self,
        value: &str,
        scalar_use: &ScalarTypeUse,
    ) -> Result<Option<String>, PassError> {
        Err(not_ported_yet("TreeSchemasExampleChecker.stringProblem"))
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
    Err(not_ported_yet("boundOf"))
}

/// Parses every example and default the run wrote against its use: each issue fails compilation at
/// its pointer inside the value, or at the deepest node of it the tree holds (a missing property is
/// reported at its object).
pub(crate) fn tree_schemas_check_written_examples(
    checks: &[TreeSchemasExampleCheck],
    checker: &TreeSchemasExampleChecker,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasCheckWrittenExamples"))
}
