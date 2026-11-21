//! Finalize (ADR 0006 sections 1 and 3, ADR 0004 sections 9 to 11): from the complete draft of one
//! api, the canonical IR with its finalize members, pruned to the reachable declarations, refused on
//! an id collision and checked against the strict IR schema, and its side table.

use seampact_diagnostics::InternalError;
use seampact_ir::{ContractIr, SourceMap};
use seampact_json::JsonValue;
use seampact_pipeline::DraftIr;

use crate::canonical_order::finalize_canonical_order;
use crate::collisions::finalize_id_collisions;
use crate::context::FinalizeContext;
use crate::members::{FEATURE_TABLE, finalize_members, finalize_operation_features};
use crate::prune::finalize_prune;
use crate::source_map::finalize_source_map;
use crate::validate::{finalize_assert_ir, finalize_assert_source_map};

/// What finalize produces for one api: the canonical IR and its side table.
#[derive(Debug, Clone, PartialEq)]
pub struct Finalized {
    /// The finalized IR.
    pub ir: ContractIr,
    /// Where each location of the IR was written.
    pub source_map: SourceMap,
}

fn strings(values: impl IntoIterator<Item = String>) -> JsonValue {
    JsonValue::Array(values.into_iter().map(JsonValue::String).collect())
}

fn number(value: i64) -> Result<JsonValue, InternalError> {
    serde_json::to_value(value)
        .ok()
        .and_then(|number| JsonValue::try_from(number).ok())
        .ok_or_else(|| InternalError::new("an IR version is no JSON number"))
}

// The operations with their `features`, and the top-level members finalize writes.
fn write_members(ir: &mut JsonValue) -> Result<(), InternalError> {
    let JsonValue::Object(root) = ir else {
        return Err(InternalError::new("the draft is no JSON object"));
    };
    let mut operation_features = Vec::new();

    if let Some(JsonValue::Array(operations)) = root.get_mut("operations") {
        for operation in operations {
            let JsonValue::Object(members) = operation else {
                return Err(InternalError::new(
                    "an operation of the draft is no JSON object",
                ));
            };
            let features = finalize_operation_features(members, FEATURE_TABLE);

            members.insert(
                "features".to_owned(),
                strings(features.iter().map(|feature| feature.as_str().to_owned())),
            );
            operation_features.push(features);
        }
    }

    let members = finalize_members(&operation_features);
    let additions: Vec<(&str, JsonValue)> = vec![
        ("irVersion", number(members.ir_version)?),
        ("irRevision", number(members.ir_revision)?),
        (
            "kinds",
            strings(members.kinds.iter().map(|kind| kind.as_str().to_owned())),
        ),
        (
            "features",
            strings(
                members
                    .features
                    .iter()
                    .map(|feature| feature.as_str().to_owned()),
            ),
        ),
    ];

    for (name, value) in additions {
        root.insert(name.to_owned(), value);
    }

    Ok(())
}

fn decode_ir(api: &str, ir: &JsonValue) -> Result<ContractIr, InternalError> {
    let value = serde_json::to_value(ir).map_err(|error| {
        InternalError::new(format!("the IR of api '{api}' does not encode: {error}"))
    })?;

    serde_json::from_value(value).map_err(|error| {
        InternalError::new(format!("the IR of api '{api}' does not decode: {error}"))
    })
}

/// Finalizes the complete draft of one api; its parts move into the IR.
///
/// Answers `None` after reporting an id collision.
///
/// # Errors
///
/// An [`InternalError`] when the draft builds an invalid IR or side table: a pass wrote a member
/// it should not have.
pub fn finalize(
    draft: DraftIr,
    context: &mut FinalizeContext<'_>,
) -> Result<Option<Finalized>, InternalError> {
    let api = context.raw.name.clone();
    let mut ir = draft.to_json_value()?;

    drop(draft);

    finalize_prune(&mut ir)?;

    let collisions = finalize_id_collisions(&ir)?;

    if !collisions.is_empty() {
        for diagnostic in collisions {
            context.report(diagnostic);
        }

        return Ok(None);
    }

    finalize_canonical_order(&mut ir)?;
    write_members(&mut ir)?;
    finalize_assert_ir(&api, &ir)?;

    let source_map = finalize_source_map(&ir, context)?;

    finalize_assert_source_map(&api, &source_map)?;

    Ok(Some(Finalized {
        ir: decode_ir(&api, &ir)?,
        source_map,
    }))
}
