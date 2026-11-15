//! The api-wide wire conventions a target acts on (`api.wire`, ADR 0004 section 13): the `int64`
//! wire form, the handling of output enums and the URL form, written as the effective conventions
//! set them, core defaults included. The validate stage refuses any other value, so one here is an
//! internal error.

use seampact_diagnostics::InternalError;
use seampact_ir::{ApiWire, Int64Wire, OutputEnumForm, UrlForm};
use seampact_json::{JsonValue, stringify_json};

use crate::routes::DeriveWireScope;

/// Writes `api.wire` from the effective conventions.
///
/// # Errors
///
/// An internal error when a convention holds a value the validate stage refuses, or the draft has
/// no api.
pub(crate) fn derive_wire_api_wire(
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    if scope.draft.api.is_none() {
        return Err(InternalError::new(
            "derive.wire runs after tree.nodes, which writes the api".to_owned(),
        ));
    }

    scope.output.api_wire = ApiWire {
        int64: effective_value(
            scope,
            "int64",
            &[("string", Int64Wire::String), ("number", Int64Wire::Number)],
        )?,
        output_enums: effective_value(
            scope,
            "outputEnums",
            &[
                ("enum", OutputEnumForm::Enum),
                ("open", OutputEnumForm::Open),
            ],
        )?,
        urls: effective_value(
            scope,
            "urls",
            &[
                ("relative", UrlForm::Relative),
                ("absolute", UrlForm::Absolute),
            ],
        )?,
    };

    Ok(())
}

fn effective_value<V: Clone>(
    scope: &DeriveWireScope<'_, '_, '_>,
    path: &str,
    known: &[(&str, V)],
) -> Result<V, InternalError> {
    let reading = scope.context.conventions.get(path)?;
    let value = reading.map(|reading| reading.value);
    let effective = match value {
        Some(JsonValue::String(text)) => known
            .iter()
            .find(|(name, _)| name == text)
            .map(|(_, candidate)| candidate.clone()),
        _ => None,
    };

    effective.ok_or_else(|| {
        let names: Vec<&str> = known.iter().map(|(name, _)| *name).collect();

        InternalError::new(format!(
            "conventions.{path} is {}, none of {}: the validate stage refuses it",
            value.map_or_else(|| "undefined".to_owned(), stringify_json),
            names.join(", ")
        ))
    })
}
