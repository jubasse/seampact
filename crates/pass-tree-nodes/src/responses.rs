//! The `responses` of an operation: the format and media it answers in, the declared or derived responses and their headers.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, Docs, OpShorthand, Origin, Response, ResponseHeader, ResponseShape,
};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_member;
use seampact_pipeline::{NearestSetting, PassError, TreeNode};

use crate::api::text_of;
use crate::formats::TREE_NODES_DEFAULT_MEDIA;

use crate::fields::{TreeNodesField, TreeNodesSite};
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The status of a success that writes none.
const DEFAULT_STATUS: i64 = 200;
const NO_CONTENT: i64 = 204;
const REDIRECT_STATUSES: &[i64] = &[301, 302, 303, 307, 308];
/// The paging value that names no style.
pub(crate) const TREE_NODES_PAGING_NONE: &str = "none";
/// The ops whose response is one item.
const ITEM_OPS: &[OpShorthand] = &[OpShorthand::Get, OpShorthand::Create, OpShorthand::Update];
/// The derivation of a response read from the format.
const FORMAT_DERIVATION: DerivationId = DerivationId::from_static("response.format");
/// The derivation of a batch read.
const BATCH_DERIVATION: DerivationId = DerivationId::from_static("batch.read");
/// The shapes that bypass the format: a download and a redirect.
const BYPASSING_SHAPES: &[ResponseShape] = &[ResponseShape::Binary, ResponseShape::Redirect];
/// The members a route writes `responses` instead of.
const RESPONSES_INSTEAD_OF: &[&str] = &["output", "item"];

/// The two members that name a response body schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BodyMember {
    Output,
    Item,
}

fn empty_response(status: i64, origin: &Origin) -> Response {
    Response {
        status,
        media: None,
        body: None,
        shape: ResponseShape::Empty,
        headers: Vec::new(),
        origin: Some(origin.clone()),
        derived_from: None,
        docs: None,
    }
}
// A format's success media: as its declaration writes it, else JSON, which the core `bare` format uses.
fn media_of(format: &str, scope: &TreeNodesScope<'_, '_, '_>) -> String {
    let declared = tree_nodes_member(scope.context.raw.merged.get("formats"), format);

    text_of(tree_nodes_member(declared, "media"))
        .unwrap_or(TREE_NODES_DEFAULT_MEDIA)
        .to_owned()
}
/// The wire format of an operation: the nearest `format`, else `conventions.format`.
pub(crate) fn tree_nodes_format(
    site: &TreeNodesSite<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<String, InternalError> {
    let nearest = scope
        .context
        .inherited
        .nearest(site.node_id, &NearestSetting::Format)?
        .map(|entry| entry.value);
    let convention = scope.context.conventions.get("format")?;
    let format = nearest.or_else(|| convention.map(|reading| reading.value));

    match format {
        Some(JsonValue::String(format)) => Ok(format.clone()),
        _ => Err(InternalError::new(format!(
            "the operation {} resolves no format",
            site.operation_id
        ))),
    }
}
pub(crate) fn tree_nodes_is_list(_node: &TreeNode<'_>) -> Result<bool, PassError> {
    Err(not_ported_yet("treeNodesIsList"))
}

fn check_no_content_body(
    _site: &TreeNodesSite<'_, '_>,
    _response: &Response,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkNoContentBody"))
}

pub(crate) fn tree_nodes_responses(
    _site: &TreeNodesSite<'_, '_>,
    _format: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    Err(not_ported_yet("treeNodesResponses"))
}

fn format_origin_of(
    _site: &TreeNodesSite<'_, '_>,
    _format: &str,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Origin>, PassError> {
    Err(not_ported_yet("formatOriginOf"))
}

fn declared_responses(
    _site: &TreeNodesSite<'_, '_>,
    _op: Option<&OpShorthand>,
    _media: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    Err(not_ported_yet("declaredResponses"))
}

fn output_status(
    _site: &TreeNodesSite<'_, '_>,
    _op: Option<&OpShorthand>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<i64, PassError> {
    Err(not_ported_yet("outputStatus"))
}

fn docs_of(_entry: Option<&JsonValue>) -> Result<Option<Docs>, PassError> {
    Err(not_ported_yet("docsOf"))
}

fn body_response(
    _site: &TreeNodesSite<'_, '_>,
    _owner: &TreeNode<'_>,
    _member: BodyMember,
    _status: i64,
    _shape: &ResponseShape,
    _media: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    Err(not_ported_yet("bodyResponse"))
}

fn list_shape(_node: &TreeNode<'_>) -> Result<ResponseShape, PassError> {
    Err(not_ported_yet("listShape"))
}

fn op_status(
    _site: &TreeNodesSite<'_, '_>,
    _op: &OpShorthand,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<i64, PassError> {
    Err(not_ported_yet("opStatus"))
}

fn op_responses(
    _site: &TreeNodesSite<'_, '_>,
    _op: &OpShorthand,
    _media: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    Err(not_ported_yet("opResponses"))
}

fn check_responses_alone(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkResponsesAlone"))
}

fn response_headers(
    _site: &TreeNodesSite<'_, '_>,
    _written: Option<&JsonValue>,
    _pointer: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<ResponseHeader>, PassError> {
    Err(not_ported_yet("responseHeaders"))
}

fn written_response(
    _site: &TreeNodesSite<'_, '_>,
    _status_key: &str,
    _media: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Response, PassError> {
    Err(not_ported_yet("writtenResponse"))
}

fn batch_table(
    _site: &TreeNodesSite<'_, '_>,
    _item_writer: &TreeNode<'_>,
    _status: i64,
    _media: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    Err(not_ported_yet("batchTable"))
}

fn report_redirect_body(
    _site: &TreeNodesSite<'_, '_>,
    _status: i64,
    _body_pointer: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportRedirectBody"))
}

fn report_no_item(
    _site: &TreeNodesSite<'_, '_>,
    _owner: &TreeNode<'_>,
    _op: &OpShorthand,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportNoItem"))
}

fn report_header_twice(
    _site: &TreeNodesSite<'_, '_>,
    _field: &TreeNodesField,
    _first: &TreeNodesField,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportHeaderTwice"))
}
