//! The validate stage: every layer of every api, and the workspace entry, checked as their kind.

use std::collections::HashSet;

use seampact_authoring::{FileLayer, LayerSchemaKind, RawLayer, RawWorkspace};
use seampact_diagnostics::{Diagnostic, DiagnosticLayer, InternalError};
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;
use seampact_load::diagnostic_layer_of;

use crate::ajv_error::ajv_errors;
use crate::authoring_validators::AuthoringValidators;
use crate::convert::{ConvertContext, convert_errors};
use crate::json_value::serde_value_of;
use crate::keyword_problems::PackRoot;

/// The diagnostics listed under one api: their origins name layers that api reaches, so a consumer
/// locates them through that api's `locations` table.
#[derive(Debug, Clone, PartialEq)]
pub struct ApiDiagnostics {
    /// The api's name.
    pub api: String,
    /// Its diagnostics, sorted.
    pub diagnostics: Vec<Diagnostic>,
}

/// The validate stage's output for a workspace.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WorkspaceDiagnostics {
    /// The workspace entry file's own diagnostics (kind `workspace`), located through the
    /// workspace's `locations` under `workspace#<pointer>`; empty when the entry is a single api
    /// file, which is listed as the api's own layer.
    pub workspace: Vec<Diagnostic>,
    /// One entry per api, in workspace order.
    pub apis: Vec<ApiDiagnostics>,
}

fn schema_file_kind(kind: LayerSchemaKind) -> &'static str {
    match kind {
        LayerSchemaKind::Workspace => "workspace",
        LayerSchemaKind::Api => "api",
        LayerSchemaKind::Base => "base",
        LayerSchemaKind::Pack => "pack",
    }
}

// ADR 0006 section 4 sorts by file, line, column, rule; without the side table, the stage sorts by
// layer, then pointer, then rule, then message, so its output is stable on its own.
fn sort_diagnostics(mut diagnostics: Vec<Diagnostic>) -> Vec<Diagnostic> {
    diagnostics.sort_by(|first, second| {
        let layers = cmp_utf16(
            &first.origin.layer.to_string(),
            &second.origin.layer.to_string(),
        );

        layers
            .then_with(|| cmp_utf16(&first.origin.pointer, &second.origin.pointer))
            .then_with(|| cmp_utf16(first.rule.as_str(), second.rule.as_str()))
            .then_with(|| cmp_utf16(&first.message, &second.message))
    });

    diagnostics
}

/// One document (a layer's tree or the workspace file) validated as `kind`.
///
/// # Errors
///
/// An [`InternalError`] when an embedded schema does not compile or a failure cannot be converted.
pub fn validate_document(
    kind: LayerSchemaKind,
    tree: &JsonValue,
    layer: &DiagnosticLayer,
) -> Result<Vec<Diagnostic>, InternalError> {
    let schemas = AuthoringValidators::shared()?;
    let validator = schemas.validator_for(schema_file_kind(kind))?;
    let instance = serde_value_of(tree)?;

    if validator.is_valid(&instance) {
        return Ok(Vec::new());
    }

    let errors = ajv_errors(validator, &instance, schemas)?;
    let context = ConvertContext {
        layer: layer.clone(),
        pack_root: if kind == LayerSchemaKind::Pack {
            PackRoot::Pack
        } else {
            PackRoot::NotPack
        },
    };

    Ok(sort_diagnostics(convert_errors(&errors, &context)?))
}

/// One layer of an api validated as its kind.
///
/// # Errors
///
/// As [`validate_document`].
pub fn validate_layer(layer: &RawLayer) -> Result<Vec<Diagnostic>, InternalError> {
    let file_layer = FileLayer::Api(layer.layer.clone());

    validate_document(
        file_layer.schema_kind(),
        &JsonValue::Object(layer.tree.clone()),
        &diagnostic_layer_of(&file_layer),
    )
}

/// Every layer of every api, each file once: a layer reached by several apis (the shared file, a
/// pack) is validated once and its diagnostics listed under the first api that reaches it. An empty
/// api entry means no diagnostic is listed there, not that every layer the api reaches is valid.
/// Any diagnostic in any entry, `workspace` included, stops the pipeline after this stage.
///
/// # Errors
///
/// As [`validate_document`].
pub fn validate_workspace(workspace: &RawWorkspace) -> Result<WorkspaceDiagnostics, InternalError> {
    let mut seen: HashSet<(FileLayer, &str)> = HashSet::new();
    let mut apis = Vec::new();

    for api in &workspace.apis {
        let mut diagnostics = Vec::new();

        for layer in &api.layers {
            if !seen.insert((FileLayer::Api(layer.layer.clone()), layer.file.as_str())) {
                continue;
            }

            diagnostics.extend(validate_layer(layer)?);
        }

        apis.push(ApiDiagnostics {
            api: api.name.clone(),
            diagnostics: sort_diagnostics(diagnostics),
        });
    }

    let entry_diagnostics = match &workspace.entry {
        Some(entry) => validate_document(
            LayerSchemaKind::Workspace,
            &JsonValue::Object(entry.tree.clone()),
            &diagnostic_layer_of(&FileLayer::Workspace),
        )?,
        None => Vec::new(),
    };

    Ok(WorkspaceDiagnostics {
        workspace: entry_diagnostics,
        apis,
    })
}

#[cfg(test)]
mod tests {
    use seampact_diagnostics::DiagnosticLayer;
    use seampact_json::JsonValue;

    use super::*;

    type PointerMessageFix = (String, String, String);

    fn tree(text: &str) -> Result<JsonValue, Box<dyn std::error::Error>> {
        Ok(JsonValue::try_from(serde_json::from_str::<
            serde_json::Value,
        >(text)?)?)
    }

    fn messages(
        kind: LayerSchemaKind,
        text: &str,
    ) -> Result<Vec<PointerMessageFix>, Box<dyn std::error::Error>> {
        let diagnostics = validate_document(kind, &tree(text)?, &DiagnosticLayer::Api)?;

        Ok(diagnostics
            .into_iter()
            .map(|d| (d.origin.pointer, d.message, d.fix))
            .collect())
    }

    #[test]
    fn a_valid_document_has_no_diagnostic() -> Result<(), Box<dyn std::error::Error>> {
        assert_eq!(
            messages(
                LayerSchemaKind::Api,
                r#"{"api":{"name":"tasks","version":1}}"#
            )?,
            Vec::new()
        );

        Ok(())
    }

    #[test]
    fn a_misspelt_key_suggests_the_closest_keyword() -> Result<(), Box<dyn std::error::Error>> {
        let found = messages(
            LayerSchemaKind::Api,
            r#"{"api":{"name":"tasks","version":1,"nam":2}}"#,
        )?;

        assert_eq!(
            found,
            vec![(
                "/api/nam".to_owned(),
                "'nam' is not a keyword of 'api'.".to_owned(),
                "Did you mean 'name'?".to_owned()
            )]
        );

        Ok(())
    }

    #[test]
    fn diagnostics_are_sorted_by_layer_pointer_rule_and_message()
    -> Result<(), Box<dyn std::error::Error>> {
        let found = messages(
            LayerSchemaKind::Api,
            r#"{"zzz":1,"api":{"name":"tasks","version":1},"aaa":2}"#,
        )?;
        let pointers: Vec<&str> = found
            .iter()
            .map(|(pointer, _, _)| pointer.as_str())
            .collect();

        assert_eq!(pointers, ["/aaa", "/zzz"]);

        Ok(())
    }

    #[test]
    fn a_key_at_a_pack_root_is_refused_as_not_a_pack_key() -> Result<(), Box<dyn std::error::Error>>
    {
        let found = messages(LayerSchemaKind::Pack, r#"{"packs":[]}"#)?;
        let packs: Vec<&PointerMessageFix> = found
            .iter()
            .filter(|(pointer, _, _)| pointer == "/packs")
            .collect();

        assert_eq!(packs.len(), 1);
        assert_eq!(
            packs.first().map(|found| found.2.as_str()),
            Some("List the packs this pack builds on in 'pack.extends'.")
        );

        Ok(())
    }
}
