//! The `input` member of an operation: its media type and schema, the fields of a form, and the files below the top level.

use seampact_diagnostics::{DiagnosticOrigin, InternalError};
use seampact_ir::{Direction, FieldWire, InputField, InputMediaType, Origin, Property, TypeUse};
use seampact_pass_tree_shared::tree_nodes_answered_use;
use seampact_pipeline::{DraftOperationInput, PassError, TreeNode};

use crate::diagnostics::tree_nodes_node_origin;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

const JSON_MEDIA: InputMediaType = InputMediaType::ApplicationJson;
const REF_KEY: &str = "$ref";
const FORM_MEDIA: InputMediaType = InputMediaType::ApplicationXWwwFormUrlencoded;
const MULTIPART_MEDIA: InputMediaType = InputMediaType::MultipartFormData;
/// The media each `input` setting value stands for.
const MEDIA_OF_INPUT_MEDIA: &[(&str, InputMediaType)] = &[
    ("json", JSON_MEDIA),
    ("form", FORM_MEDIA),
    ("multipart", MULTIPART_MEDIA),
];
/// How a message names each media.
const MEDIA_WORD: &[(InputMediaType, &str)] = &[
    (JSON_MEDIA, "JSON"),
    (FORM_MEDIA, "form"),
    (MULTIPART_MEDIA, "multipart"),
];

/// Where an input is checked: the operation and the media its schema is written for.
#[derive(Debug, Clone)]
struct InputSite<'node, 'raw> {
    node: &'node TreeNode<'raw>,
    operation_id: &'node str,
    origin: DiagnosticOrigin,
    media: InputMediaType,
}

/// A file reached below the top level of an input.
#[derive(Debug, Clone, PartialEq)]
struct NestedFile {
    path: String,
    origin: Option<Origin>,
}

fn join_path(path: &str, member: &str) -> String {
    if path.is_empty() {
        return member.to_owned();
    }

    format!("{path}.{member}")
}

/// The input a route or an op entry declares (`input`), or `None` when it declares none.
///
/// The schema is the input use the service answers for the written schema; reads `schemas` for the fields of a
/// form or multipart body.
pub(crate) fn tree_nodes_input(
    node: &TreeNode<'_>,
    operation_id: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperationInput>, PassError> {
    if !node.settings.contains_key("input") {
        return Ok(None);
    }

    let pointer = format!("{}/input", node.pointer);
    let Some(origin) = scope.context.origin(&pointer) else {
        return Err(InternalError::new(format!(
            "the raw tree has no origin for the input at {pointer}"
        ))
        .into());
    };
    let schema = tree_nodes_answered_use(scope.schemas, &pointer, &Direction::Input)?;
    let media = media_of(node)?;
    let site = InputSite {
        node,
        operation_id,
        origin: tree_nodes_node_origin(&origin)?,
        media: media.clone(),
    };
    let is_json = media == JSON_MEDIA;
    let input = DraftOperationInput {
        media,
        schema: schema.clone(),
        body_limit_bytes: None,
        raw_body: None,
        fields: None,
        proofs: None,
        origin,
    };

    if is_json {
        let files = files_below(&schema, None, scope)?;

        report_nested_files(&site, &files, None, scope)?;

        return Ok(Some(input));
    }

    let fields = form_fields(&site, &schema, scope)?;

    Ok(Some(DraftOperationInput { fields, ..input }))
}

fn media_of(_node: &TreeNode<'_>) -> Result<InputMediaType, PassError> {
    Err(not_ported_yet("mediaOf"))
}

fn report_nested_files(
    _site: &InputSite<'_, '_>,
    _files: &[NestedFile],
    _field: Option<&str>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportNestedFiles"))
}

fn files_below(
    _type_use: &TypeUse,
    _use_origin: Option<&Origin>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<NestedFile>, PassError> {
    Err(not_ported_yet("filesBelow"))
}

pub(crate) fn tree_nodes_batch_input(
    _node: &TreeNode<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperationInput>, PassError> {
    Err(not_ported_yet("treeNodesBatchInput"))
}

fn input_schema_pointer(_node: &TreeNode<'_>, _schema_id: &str) -> Result<String, PassError> {
    Err(not_ported_yet("inputSchemaPointer"))
}

fn media_word(_media: &InputMediaType) -> Result<String, PassError> {
    Err(not_ported_yet("mediaWord"))
}

fn form_fields(
    _site: &InputSite<'_, '_>,
    _schema: &TypeUse,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Vec<InputField>>, PassError> {
    Err(not_ported_yet("formFields"))
}

fn field_wire(
    _site: &InputSite<'_, '_>,
    _property: &Property,
    _field_pointer: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<FieldWire>, PassError> {
    Err(not_ported_yet("fieldWire"))
}

fn check_file_field(
    _site: &InputSite<'_, '_>,
    _property: &Property,
    _at: &DiagnosticOrigin,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkFileField"))
}

#[cfg(test)]
mod tests {
    use super::join_path;

    #[test]
    fn a_path_below_the_top_level_is_dot_joined() {
        assert_eq!(join_path("", "file"), "file");
        assert_eq!(join_path("a", "b"), "a.b");
        assert_eq!(join_path("a.b", ""), "a.b.");
    }
}
