//! The side table of one api's IR (ADR 0004 section 11): one entry per origin of the IR, found in
//! the api's locations.
//!
//! A `core` origin has none (no file), and nor has an origin that names another `api`: a relay
//! route copied it, and it resolves in that api's own table (ADR 0004 section 6).

use seampact_authoring::ApiLayer;
use seampact_diagnostics::{
    DiagnosticLayer, DiagnosticOrigin, InternalError, diagnostic_location_key,
};
use seampact_ir::{
    IR_REVISION, IrInstanceNode, IrMap, PackName, SourceLocation, SourceMap, walk_ir_instance,
};
use seampact_json::{JsonObject, JsonValue};

use crate::context::FinalizeContext;
use crate::record::finalize_is_record;

const ORIGIN_DEFINITION: &str = "Origin";
const CONTRACT_IR_REFERENCE: &str = "#/$defs/ContractIR";
const PACK_LAYER_PREFIX: &str = "pack:";

/// An origin of the IR as the walk found it.
struct FoundOrigin {
    at: String,
    layer: Option<String>,
    pointer: Option<String>,
}

fn layer_text(value: &JsonObject) -> Option<String> {
    match value.get("layer") {
        Some(JsonValue::String(layer)) => Some(layer.clone()),
        _ => None,
    }
}

// The layer of an api's raw tree: `core` has no file and no IR element carries `workspace`.
fn api_layer_of(layer: &str) -> Option<DiagnosticLayer> {
    match layer {
        "api" => Some(DiagnosticLayer::Api),
        "shared" => Some(DiagnosticLayer::Shared),
        "base" => Some(DiagnosticLayer::Base),
        other => other
            .strip_prefix(PACK_LAYER_PREFIX)
            .map(|name| DiagnosticLayer::Pack(name.to_owned())),
    }
}

fn found_origins(ir: &JsonValue) -> Result<Vec<FoundOrigin>, InternalError> {
    let schema: JsonObject = [(
        "$ref".to_owned(),
        JsonValue::String(CONTRACT_IR_REFERENCE.to_owned()),
    )]
    .into_iter()
    .collect();
    let mut origins = Vec::new();

    walk_ir_instance(ir, &schema, "", &mut |node| {
        let IrInstanceNode::Object {
            pointer,
            definition: Some(ORIGIN_DEFINITION),
            value,
        } = node
        else {
            return Ok(());
        };

        if value.contains_key("api") || layer_text(value).as_deref() == Some("core") {
            return Ok(());
        }

        origins.push(FoundOrigin {
            at: (*pointer).to_owned(),
            layer: layer_text(value),
            pointer: match value.get("pointer") {
                Some(JsonValue::String(text)) => Some(text.clone()),
                _ => None,
            },
        });

        Ok(())
    })
    .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(origins)
}

// The side table's `file` allows no `..` segment, and where a pack sits depends on the package
// manager's hoisting. Every pack file is written as the bundle writer vendors it,
// `.packs/<name>@<version>/<path in the package>`: the name is the package's, the version is read
// from the manifest of the package's `pack:<name>` layer.
fn side_table_file(file: &str, context: &FinalizeContext<'_>) -> Result<String, InternalError> {
    let api = &context.raw.name;
    let Some(parts) = context.pack_files.parts(file) else {
        if !context.pack_files.is_inside_workspace(file) {
            return Err(InternalError::new(format!(
                "finalize: the file '{file}' of api '{api}' is above the workspace root and in no pack package, so the side table cannot name it"
            )));
        }

        return Ok(file.to_owned());
    };
    let layer = ApiLayer::Pack(PackName::new(parts.name.to_owned()));
    let version = context
        .raw
        .layers
        .iter()
        .find(|candidate| candidate.layer == layer)
        .and_then(|candidate| candidate.tree.get("pack"))
        .and_then(finalize_is_record)
        .and_then(|manifest| manifest.get("version"));
    let Some(JsonValue::String(version)) = version else {
        return Err(InternalError::new(format!(
            "finalize: the pack file '{file}' of api '{api}' is in a package whose layer 'pack:{}' has no manifest version, so the side table cannot name it",
            parts.name
        )));
    };

    Ok(context
        .pack_files
        .vendored_file(parts.name, version, parts.inside))
}

/// The side table of `ir`, the finalized IR as JSON: one location per authored origin.
///
/// # Errors
///
/// An [`InternalError`] for an origin with no valid layer or pointer, one found in no source
/// table, or a file the side table cannot name.
pub fn finalize_source_map(
    ir: &JsonValue,
    context: &FinalizeContext<'_>,
) -> Result<SourceMap, InternalError> {
    let api = &context.raw.name;
    let mut locations: IrMap<String, SourceLocation> = IrMap::new();

    for origin in found_origins(ir)? {
        let (Some(layer_name), Some(pointer)) = (&origin.layer, &origin.pointer) else {
            return Err(no_valid_origin(&origin, api));
        };
        let Some(layer) = api_layer_of(layer_name) else {
            return Err(no_valid_origin(&origin, api));
        };
        let key = diagnostic_location_key(&DiagnosticOrigin {
            layer,
            pointer: pointer.clone(),
            api: None,
        });
        let Some(location) = context.locations.get(&key) else {
            return Err(InternalError::new(format!(
                "finalize: the origin '{key}' at '{}' of api '{api}' is in no source table, so the pass that wrote it located it nowhere",
                origin.at
            )));
        };

        locations.insert(
            key,
            SourceLocation {
                file: side_table_file(&location.file, context)?,
                line: i64::from(location.line),
                column: i64::from(location.column),
                end_line: i64::from(location.end_line),
                end_column: i64::from(location.end_column),
            },
        );
    }

    Ok(SourceMap {
        ir_revision: IR_REVISION,
        locations,
    })
}

fn no_valid_origin(origin: &FoundOrigin, api: &str) -> InternalError {
    InternalError::new(format!(
        "finalize: the origin at '{}' of api '{api}' has no valid layer or pointer",
        origin.at
    ))
}
