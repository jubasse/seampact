//! `request.json`: the request a probe received, as its twin writes it.

use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, indented_json};
use seampact_target::{
    ArtefactSet, FrameworkRouteCheck, GenerateInput, HookBootCheck, ImportSpecifierStyle, LinkSet,
    NativeDocsDocument, TargetMetadata,
};
use serde::Serialize;
use std::collections::BTreeMap;

use crate::ProbeOptions;

/// The echoed file's name.
pub(crate) const REQUEST_FILE: &str = "request.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RequestEcho<'run> {
    api: &'run str,
    operations: Vec<&'run str>,
    links: &'run LinkSet,
    artefacts: Vec<&'run str>,
    framework_routes: &'run FrameworkRouteCheck,
    hook_check: HookBootCheck,
    mount: &'run str,
    import_specifiers: ImportSpecifierStyle,
    installed_runtimes: BTreeMap<&'run str, Option<&'run str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_docs_document: Option<&'run NativeDocsDocument>,
}

/// The text of `request.json` for `input`, in the layout the writer gives every JSON file.
///
/// # Errors
///
/// An [`InternalError`] when a request member is not JSON, which its types forbid.
pub(crate) fn request_text(
    input: &GenerateInput<'_, ProbeOptions>,
    metadata: &TargetMetadata,
) -> Result<String, InternalError> {
    let artefacts: &ArtefactSet = input.artefacts;
    let installed_runtimes = metadata
        .runtime_packages
        .iter()
        .map(|package| {
            (
                *package,
                input.installed_runtimes.version(package).flatten(),
            )
        })
        .collect();
    let echo = RequestEcho {
        api: &input.ir.api.id,
        operations: input
            .ir
            .operations
            .iter()
            .map(|operation| operation.id.as_str())
            .collect(),
        links: input.links,
        artefacts: artefacts.sorted(),
        framework_routes: input.framework_routes,
        hook_check: input.hook_check,
        mount: input.mount,
        import_specifiers: input.import_specifiers,
        installed_runtimes,
        native_docs_document: input.native_docs_document,
    };

    let value = serde_json::to_value(&echo).map_err(not_json)?;
    let value = JsonValue::try_from(value).map_err(not_json)?;

    Ok(indented_json(&value))
}

fn not_json(error: impl std::fmt::Display) -> InternalError {
    InternalError::new(format!("the probe request is not JSON: {error}"))
}
