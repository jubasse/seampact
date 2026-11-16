//! A document held to the strict form of the IR schemas.

use jsonschema::Validator;
use jsonschema::error::ValidationErrorKind;
use seampact_ir::{IrInstanceNode, IrUnknown, visit_ir_unknown, walk_ir_instance};
use seampact_json::{JsonObject, JsonValue, escape_pointer};

use crate::IrCheckError;
use crate::serde_value::serde_value_through_f64;
use crate::strict_validators::StrictValidators;

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
    let mut failures = schema_failures(StrictValidators::shared()?.ir(), ir)?;

    failures.extend(unknown_failures(ir)?);

    Ok(failures)
}

/// Holds a source map to its schema.
///
/// # Errors
///
/// [`IrCheckError`] when the schemas do not build or a number has no `f64`.
pub fn check_source_map(source_map: &JsonValue) -> Result<Vec<IrCheckFailure>, IrCheckError> {
    schema_failures(StrictValidators::shared()?.source_map(), source_map)
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
            }) => kinds.push(IrCheckFailure::UnknownKind {
                pointer: pointer.to_owned(),
                tag: tag.to_owned(),
                value: value.to_owned(),
            }),
            Some(IrUnknown::Value { pointer, value }) => {
                values.push(IrCheckFailure::UnknownValue {
                    pointer: pointer.to_owned(),
                    value: value.to_owned(),
                });
            }
            None => {}
        }

        Ok(())
    })?;

    kinds.extend(values);

    Ok(kinds)
}
