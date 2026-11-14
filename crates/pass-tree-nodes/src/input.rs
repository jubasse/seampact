//! The `input` member of an operation: its media type and schema, the fields of a form, and the files below the top level.

use seampact_diagnostics::DiagnosticOrigin;
use seampact_ir::{FieldWire, InputField, InputMediaType, Origin, Property, TypeUse};
use seampact_pipeline::{DraftOperationInput, PassError, TreeNode};

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

fn join_path(_path: &str, _member: &str) -> Result<String, PassError> {
    Err(not_ported_yet("joinPath"))
}

pub(crate) fn tree_nodes_input(
    _node: &TreeNode<'_>,
    _operation_id: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperationInput>, PassError> {
    Err(not_ported_yet("treeNodesInput"))
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
