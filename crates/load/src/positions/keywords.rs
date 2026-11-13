//! The schema keywords the position reading models, and those it ignores on purpose.

/// The schema keywords the reading models.
pub const POSITION_KEYWORDS: &[&str] = &[
    "$ref",
    "allOf",
    "anyOf",
    "oneOf",
    "if",
    "then",
    "else",
    "not",
    "type",
    "enum",
    "const",
    "properties",
    "patternProperties",
    "additionalProperties",
    "items",
    "required",
    "title",
];

/// The schema keywords the reading ignores on purpose: annotations, and value constraints that
/// neither lead to another node nor change a scalar's type (the validate stage checks them).
///
/// One exception: the integer bounds `minimum`, `maximum`, `exclusiveMinimum` and
/// `exclusiveMaximum` (no schema uses the last one yet, so it is not listed here) are read by
/// `Positions::admits_integer`, only to tell whether a quoted whole number reads as the integer.
pub const IGNORED_KEYWORDS: &[&str] = &[
    "$schema",
    "$defs",
    "$comment",
    "description",
    "pattern",
    "minLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "minItems",
    "minProperties",
    "maxProperties",
    "propertyNames",
];
