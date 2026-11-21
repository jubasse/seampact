//! A document held to the strict form of the IR schemas.

use jsonschema::Validator;
use jsonschema::error::ValidationErrorKind;
use seampact_ir::{IrInstanceNode, IrUnknown, visit_ir_unknown, walk_ir_instance};
use seampact_json::{JsonObject, JsonValue, escape_pointer};

use crate::IrCheckError;
use crate::serde_value::serde_value_through_f64;
use crate::strict_validators::SchemaValidators;

/// The reference the walk of an IR document starts from.
const CONTRACT_IR_REFERENCE: &str = "#/$defs/ContractIR";

/// One finding of the strict check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrCheckFailure {
    /// A schema keyword the document fails.
    Schema {
        /// The keyword.
        keyword: String,
        /// The JSON Pointer of the failing value.
        pointer: String,
        /// The validator's message.
        message: String,
    },
    /// A member the strict form does not know.
    UnknownMember {
        /// The JSON Pointer of the member.
        pointer: String,
    },
    /// A union tag outside the known variants.
    UnknownKind {
        /// The JSON Pointer of the union object.
        pointer: String,
        /// The tag member.
        tag: String,
        /// The tag value.
        value: String,
    },
    /// An open-enum value outside the known values.
    UnknownValue {
        /// The JSON Pointer of the value.
        pointer: String,
        /// The value.
        value: String,
    },
}

/// Holds an IR document to the strict schema: its problems and unknown members, then its unknown
/// union tags and open-enum values. An empty list is a valid document.
///
/// # Errors
///
/// [`IrCheckError`] when the schemas do not build or a number has no `f64`.
pub fn check_strict_ir(ir: &JsonValue) -> Result<Vec<IrCheckFailure>, IrCheckError> {
    let mut failures = schema_failures(SchemaValidators::shared()?.ir(), ir)?;

    failures.extend(unknown_failures(ir)?);

    Ok(failures)
}

/// What the open form finds in an IR document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrOpenReport {
    /// No schema problem, no unknown member and no must-act unknown tag or value.
    pub valid: bool,
    /// The schema problems and unknown members, then every unknown union tag, then every unknown
    /// open-enum value, must-act or not.
    pub failures: Vec<IrCheckFailure>,
}

/// Holds an IR document to the schemas as published: an unknown union tag or open-enum value is
/// listed and refuses the document only when it is must-act.
///
/// # Errors
///
/// [`IrCheckError`] when the schemas do not build or a number has no `f64`.
pub fn check_open_ir(ir: &JsonValue) -> Result<IrOpenReport, IrCheckError> {
    let found = unknowns(ir)?;
    let mut failures = schema_failures(SchemaValidators::open()?.ir(), ir)?;

    // A schema without the discriminator keyword also fails a union at an unknown tag: that is the
    // unknown tag itself, listed below.
    failures.retain(|failure| match failure {
        IrCheckFailure::Schema {
            keyword, pointer, ..
        } => {
            keyword != "oneOf"
                || !found.iter().any(|unknown| {
                    matches!(&unknown.failure, IrCheckFailure::UnknownKind { pointer: at, .. } if at == pointer)
                })
        }
        _ => true,
    });

    let valid = failures.is_empty() && !found.iter().any(|unknown| unknown.must_act);

    failures.extend(found.into_iter().map(|unknown| unknown.failure));

    Ok(IrOpenReport { valid, failures })
}

/// Holds a source map to its schema.
///
/// # Errors
///
/// [`IrCheckError`] when the schemas do not build or a number has no `f64`.
pub fn check_source_map(source_map: &JsonValue) -> Result<Vec<IrCheckFailure>, IrCheckError> {
    schema_failures(SchemaValidators::shared()?.source_map(), source_map)
}

fn schema_failures(
    validator: &Validator,
    document: &JsonValue,
) -> Result<Vec<IrCheckFailure>, IrCheckError> {
    let instance = serde_value_through_f64(document)?;
    let mut failures = Vec::new();

    for error in validator.iter_errors(&instance) {
        let pointer = error.instance_path().as_str().to_owned();

        if let ValidationErrorKind::AdditionalProperties { unexpected } = error.kind() {
            failures.extend(
                unexpected
                    .iter()
                    .map(|member| IrCheckFailure::UnknownMember {
                        pointer: format!("{pointer}/{}", escape_pointer(member)),
                    }),
            );

            continue;
        }

        failures.push(IrCheckFailure::Schema {
            keyword: keyword_of(error.schema_path().as_str()),
            pointer,
            message: error.to_string(),
        });
    }

    Ok(failures)
}

// The keyword is the last segment of the schema path.
fn keyword_of(schema_path: &str) -> String {
    schema_path
        .rsplit_once('/')
        .map_or(schema_path, |(_, keyword)| keyword)
        .to_owned()
}

fn unknown_failures(ir: &JsonValue) -> Result<Vec<IrCheckFailure>, IrCheckError> {
    Ok(unknowns(ir)?
        .into_iter()
        .map(|unknown| unknown.failure)
        .collect())
}

/// An unknown union tag or open-enum value, with whether it makes the IR invalid for every reader.
struct FoundUnknown {
    failure: IrCheckFailure,
    must_act: bool,
}

/// Whether the walk's node is one whose unknown tag or value is must-act.
fn must_act_of(node: &IrInstanceNode<'_>) -> bool {
    match node {
        IrInstanceNode::Union { must_act, .. } | IrInstanceNode::OpenEnum { must_act, .. } => {
            *must_act
        }
        _ => false,
    }
}

/// The unknown union tags, then the unknown open-enum values, in walk order.
fn unknowns(ir: &JsonValue) -> Result<Vec<FoundUnknown>, IrCheckError> {
    let schema: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(CONTRACT_IR_REFERENCE.to_owned()),
    )]
    .into_iter()
    .collect();
    let mut kinds = Vec::new();
    let mut values = Vec::new();

    walk_ir_instance(ir, &schema, "", &mut |node: &IrInstanceNode<'_>| {
        match visit_ir_unknown(node) {
            Some(IrUnknown::Kind {
                pointer,
                tag,
                value,
            }) => kinds.push(FoundUnknown {
                failure: IrCheckFailure::UnknownKind {
                    pointer: pointer.to_owned(),
                    tag: tag.to_owned(),
                    value: value.to_owned(),
                },
                must_act: must_act_of(node),
            }),
            Some(IrUnknown::Value { pointer, value }) => {
                values.push(FoundUnknown {
                    failure: IrCheckFailure::UnknownValue {
                        pointer: pointer.to_owned(),
                        value: value.to_owned(),
                    },
                    must_act: must_act_of(node),
                });
            }
            None => {}
        }

        Ok(())
    })?;

    kinds.extend(values);

    Ok(kinds)
}
