//! The `responses` of an operation: the format and media it answers in, the declared or derived responses and their headers.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, Docs, OpShorthand, Origin, Response, ResponseHeader, ResponseShape,
};
use seampact_js::js_key_order;
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{TREE_NODES_LIST_OP, tree_nodes_member, tree_nodes_op_shorthand};
use seampact_pipeline::{NearestSetting, PassError, TreeNode, pointer_below};

use crate::api::text_of;
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
};
use crate::formats::{TREE_NODES_BARE_FORMAT, TREE_NODES_DEFAULT_MEDIA, tree_nodes_bare_origin};

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
/// Whether a route is a list: the list op, or a route that sets `item` instead of `output`.
pub(crate) fn tree_nodes_is_list(node: &TreeNode<'_>) -> bool {
    if let Some(op) = tree_nodes_op_shorthand(node) {
        return op == TREE_NODES_LIST_OP;
    }

    !node.settings.contains_key("responses")
        && !node.settings.contains_key("output")
        && node.settings.contains_key("item")
}

// 204 No Content carries no body (RFC 9110 section 15.3.5).
fn check_no_content_body(
    site: &TreeNodesSite<'_, '_>,
    response: &Response,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if response.status != NO_CONTENT || response.body.is_none() {
        return Ok(());
    }

    let origin = response.origin.as_ref().unwrap_or(&site.node.origin);

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::NoContentBody,
            origin: tree_nodes_node_origin(origin)?,
            message: format!(
                "The 204 response of {} has a body, which a 204 No Content never carries.",
                site.operation_id
            ),
            fix: "Answer the body with 200, or remove the body.".to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

/// The responses a route declares, sorted by status; each but a download or a redirect records that its shape
/// travels in the operation's format.
pub(crate) fn tree_nodes_responses(
    site: &TreeNodesSite<'_, '_>,
    format: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    let media = media_of(format, scope);
    let op = tree_nodes_op_shorthand(site.node);
    let responses = declared_responses(site, op.as_ref(), &media, scope)?;

    for response in &responses {
        check_no_content_body(site, response, scope)?;
    }

    let Some(format_origin) = format_origin_of(site, format, scope)? else {
        return Ok(responses);
    };

    Ok(responses
        .into_iter()
        .map(|response| {
            if response.derived_from.is_some() || BYPASSING_SHAPES.contains(&response.shape) {
                return response;
            }

            Response {
                derived_from: Some(DerivedFrom {
                    derivation: FORMAT_DERIVATION,
                    from: vec![format_origin.clone()],
                }),
                ..response
            }
        })
        .collect())
}

// A declared format's origin, else the core `bare`'s; a format declared nowhere is refused where it is named.
fn format_origin_of(
    site: &TreeNodesSite<'_, '_>,
    format: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Origin>, PassError> {
    if let Some(declared) = scope.context.origin(&pointer_below("/formats", &[format])) {
        return Ok(Some(declared));
    }

    if format == TREE_NODES_BARE_FORMAT {
        return Ok(Some(tree_nodes_bare_origin()));
    }

    let inherited = scope.context.inherited;
    let named = match inherited.nearest(site.node_id, &NearestSetting::Format)? {
        Some(entry) => Some(entry.origin),
        None => scope
            .context
            .conventions
            .get("format")?
            .and_then(|reading| reading.origin),
    };
    let Some(named) = named else {
        return Err(InternalError::new(format!(
            "the format {format} of {} is named nowhere",
            site.operation_id
        ))
        .into());
    };
    let key = format!("format-unknown:{}#{}", named.layer, named.pointer);
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::FormatUnknown,
        origin: tree_nodes_node_origin(&named)?,
        message: format!(
            "The format {format} of {} is not declared in formats.",
            site.operation_id
        ),
        fix: format!(
            "Declare {format} in formats (a format pack provides some), or name a declared format."
        ),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(None)
}

fn declared_responses(
    site: &TreeNodesSite<'_, '_>,
    op: Option<&OpShorthand>,
    media: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    let node = site.node;

    if let Some(JsonValue::Object(written)) = node.settings.get("responses") {
        check_responses_alone(site, scope)?;

        let mut responses = js_key_order(written.iter())
            .map(|(status, _)| written_response(site, status, media, scope))
            .collect::<Result<Vec<_>, _>>()?;

        responses.sort_by_key(|response| response.status);

        return Ok(responses);
    }

    if node.settings.contains_key("output") {
        let status = output_status(site, op, scope)?;

        return body_response(
            site,
            node,
            BodyMember::Output,
            status,
            &ResponseShape::Item,
            media,
            scope,
        );
    }

    if op.is_none() && node.settings.contains_key("item") {
        let shape = list_shape(node)?;

        return body_response(
            site,
            node,
            BodyMember::Item,
            DEFAULT_STATUS,
            &shape,
            media,
            scope,
        );
    }

    match op {
        None => Ok(vec![empty_response(NO_CONTENT, &node.origin)]),
        Some(op) => op_responses(site, op, media, scope),
    }
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
