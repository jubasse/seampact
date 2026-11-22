//! The contract `file:line` of an IR member or an origin, read through the compiler's side table.

use indexmap::IndexMap;
use seampact_json::{JsonValue, js_text_of};
use seampact_span::Location;

use crate::CliError;
use crate::not_ported::not_ported_yet;

/// The `layer` value of an origin that no contract file declares.
const CORE_LAYER: &str = "core";

/// The IR an api's targets read, with the file and line of each declaration; a bundle source has
/// no table, so its refusals keep the IR pointer only.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ContractPositions<'ir> {
    pub(crate) ir: &'ir JsonValue,
    pub(crate) locations: Option<&'ir IndexMap<String, Location>>,
}

/// The contract `file:line` of an IR member: the deepest node on its pointer whose origin the side
/// table locates, else the operation's own declaration.
pub(crate) fn contract_position(
    _positions: &ContractPositions<'_>,
    _member: Option<&str>,
    _operation_id: Option<&str>,
) -> Result<Option<String>, CliError> {
    Err(not_ported_yet("contractPosition"))
}

/// The `file:line` of `origin` through the side table; a core declaration has no file, and an
/// element of another api is located in that api's table.
pub(crate) fn origin_position(
    origin: &JsonValue,
    locations: &IndexMap<String, Location>,
) -> Option<String> {
    let JsonValue::Object(origin) = origin else {
        return None;
    };
    let layer = js_text_of(origin.get("layer"));

    if layer == CORE_LAYER || origin.get("api").is_some() {
        return None;
    }

    let key = format!("{layer}#{}", js_text_of(origin.get("pointer")));

    locations
        .get(&key)
        .map(|location| format!("{}:{}", location.file, location.line))
}
