//! Scalars, formats and refinements: the portable formats, the named formats of the `scalars`
//! catalogue, and refinements with numeric bounds as decimal literal strings.

use indexmap::IndexMap;
use seampact_ir::{Docs, Refinements, Scalar, ScalarType, ScalarTypeUse};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::raw::TreeSchemasReporter;

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

fn portable_type_of(format: &str) -> Result<Option<ScalarType>, PassError> {
    Err(not_ported_yet("portableTypeOf"))
}

fn tree_schemas_decimal_literal(value: f64) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("treeSchemasDecimalLiteral"))
}

fn without_exponent(text: &str) -> Result<String, PassError> {
    Err(not_ported_yet("withoutExponent"))
}

fn significant_digits(literal: &str) -> Result<usize, PassError> {
    Err(not_ported_yet("significantDigits"))
}

fn empty_ranges(
    refinements: &Refinements,
    scalar_type: &ScalarType,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("emptyRanges"))
}

fn empty_between(
    lower: &Bound,
    upper: &Bound,
    scalar_type: &ScalarType,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("emptyBetween"))
}

fn lowest_integer(bound: &Bound) -> Result<f64, PassError> {
    Err(not_ported_yet("lowestInteger"))
}

fn highest_integer(bound: &Bound) -> Result<f64, PassError> {
    Err(not_ported_yet("highestInteger"))
}

/// The scalar uses of the api: plain scalars, portable formats and the named formats of `scalars`.
#[derive(Debug)]
pub(crate) struct TreeSchemasScalars<'raw> {
    catalogue: Option<&'raw JsonValue>,
    declarations: IndexMap<String, Option<Scalar>>,
}

impl<'raw> TreeSchemasScalars<'raw> {
    pub(crate) fn new(catalogue: Option<&'raw JsonValue>) -> Result<Self, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.constructor"))
    }

    /// Every named format of the `scalars` catalogue, in written order; a refused one is left out.
    pub(crate) fn all(
        &mut self,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Vec<Scalar>, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.all"))
    }

    pub(crate) fn use_of(
        &mut self,
        value: &JsonObject,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<ScalarTypeUse>, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.use"))
    }

    fn declaration(
        &mut self,
        id: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<Scalar>, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.declaration"))
    }

    fn compile_declaration(
        &mut self,
        id: &str,
        value: &JsonObject,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<Scalar>, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.compileDeclaration"))
    }

    fn check_format_beside_type(
        &self,
        format: &str,
        scalar_type: &ScalarType,
        pointer: &str,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.checkFormatBesideType"))
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
        Err(not_ported_yet("TreeSchemasScalars.checkRanges"))
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
        Err(not_ported_yet("TreeSchemasScalars.unknownFormat"))
    }

    fn refinements(
        &self,
        value: &JsonObject,
        pointer: &str,
        target: &RefinementTarget,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<Option<Refinements>, PassError> {
        Err(not_ported_yet("TreeSchemasScalars.refinements"))
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
        Err(not_ported_yet("TreeSchemasScalars.bound"))
    }
}

pub(crate) fn tree_schemas_docs(value: Option<&JsonValue>) -> Result<Docs, PassError> {
    Err(not_ported_yet("treeSchemasDocs"))
}
