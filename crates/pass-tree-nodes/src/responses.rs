//! The `responses` of an operation: the format and media it answers in, the declared or derived responses and their headers.

use seampact_diagnostics::InternalError;
use std::collections::HashMap;

use seampact_ir::{
    DerivationId, DerivedFrom, Direction, Docs, OpShorthand, Origin, Response, ResponseHeader,
    ResponseShape, TypeUse,
};
use seampact_js::js_key_order;
use seampact_json::{JsonValue, js_integer_in_range};
use seampact_pass_tree_shared::{
    TREE_NODES_BATCH_OP, TREE_NODES_DELETE_OP, TREE_NODES_LIST_OP, tree_nodes_answered_use,
    tree_nodes_member, tree_nodes_op_owner, tree_nodes_op_shorthand, tree_nodes_text,
};
use seampact_pipeline::{NearestSetting, PassError, TreeNode, pointer_below};

use crate::api::{text_of, tree_nodes_docs};
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
};
use crate::formats::{TREE_NODES_BARE_FORMAT, TREE_NODES_DEFAULT_MEDIA, tree_nodes_bare_origin};

use crate::fields::{TreeNodesField, TreeNodesSite, tree_nodes_field_travels, tree_nodes_fields};
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

impl BodyMember {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Output => "output",
            Self::Item => "item",
        }
    }
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
            node,
            BodyMember::Output,
            status,
            &ResponseShape::Item,
            media,
            scope,
        );
    }

    if op.is_none() && node.settings.contains_key("item") {
        let shape = list_shape(node);

        return body_response(node, BodyMember::Item, DEFAULT_STATUS, &shape, media, scope);
    }

    match op {
        None => Ok(vec![empty_response(NO_CONTENT, &node.origin)]),
        Some(op) => op_responses(site, op, media, scope),
    }
}

// `output` takes the op's status, or 200; a delete with a body answers 200.
fn output_status(
    site: &TreeNodesSite<'_, '_>,
    op: Option<&OpShorthand>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<i64, PassError> {
    let Some(op) = op else {
        return Ok(DEFAULT_STATUS);
    };
    let status = op_status(site, op, scope)?;

    if *op == TREE_NODES_DELETE_OP && status == NO_CONTENT {
        return Ok(DEFAULT_STATUS);
    }

    Ok(status)
}

// The docs written on a response entry, absent when it writes none.
fn docs_of(entry: Option<&JsonValue>) -> Option<Docs> {
    let docs = tree_nodes_docs(entry);

    if docs.summary.is_none() && docs.description.is_none() {
        return None;
    }

    Some(docs)
}

// A response whose body is written at `<owner>/<member>` (`output` or `item`).
fn body_response(
    owner: &TreeNode<'_>,
    member: BodyMember,
    status: i64,
    shape: &ResponseShape,
    media: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    let pointer = pointer_below(&owner.pointer, &[member.as_str()]);
    let origin = scope
        .context
        .origin(&pointer)
        .unwrap_or_else(|| owner.origin.clone());
    let body = tree_nodes_answered_use(scope.schemas, &pointer, &Direction::Output)?;
    let is_file = matches!(body, TypeUse::File(_));

    Ok(vec![Response {
        status,
        media: (!is_file).then(|| media.to_owned()),
        shape: if is_file {
            ResponseShape::Binary
        } else {
            shape.clone()
        },
        body: Some(body),
        headers: Vec::new(),
        origin: Some(origin),
        derived_from: None,
        docs: None,
    }])
}

fn list_shape(node: &TreeNode<'_>) -> ResponseShape {
    if tree_nodes_text(node, "paging") == Some(TREE_NODES_PAGING_NONE) {
        ResponseShape::List
    } else {
        ResponseShape::Page
    }
}

fn op_status(
    site: &TreeNodesSite<'_, '_>,
    op: &OpShorthand,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<i64, PassError> {
    let path = format!("ops.{}.status", op.as_str());
    let reading = scope.context.conventions.get(&path)?;
    let Some(JsonValue::Number(number)) = reading.map(|reading| reading.value) else {
        return Err(InternalError::new(format!(
            "conventions.{path} resolves to no status (operation {})",
            site.operation_id
        ))
        .into());
    };

    js_integer_in_range(number, i64::MIN..=i64::MAX)
        .map_err(|error| InternalError::new(format!("conventions.{path}: {error}")).into())
}

// The `ops` table's default response: the op's own `item`, else the owner's, for list, get, create and update; no
// body for delete.
fn op_responses(
    site: &TreeNodesSite<'_, '_>,
    op: &OpShorthand,
    media: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    let status = op_status(site, op, scope)?;

    if *op == TREE_NODES_DELETE_OP {
        return Ok(vec![empty_response(status, &site.node.origin)]);
    }

    let owner = tree_nodes_op_owner(site.nodes, site.node)?;
    let is_list = *op == TREE_NODES_LIST_OP;
    let is_batch = *op == TREE_NODES_BATCH_OP;
    let owner = match owner {
        Some(owner) if is_list || is_batch || ITEM_OPS.contains(op) => owner,
        _ => {
            return Err(InternalError::new(format!(
                "the op at {} has no owner or no default response",
                site.node.pointer
            ))
            .into());
        }
    };
    let item_writer = if site.node.settings.contains_key("item") {
        site.node
    } else {
        owner
    };

    if !item_writer.settings.contains_key("item") {
        report_no_item(site, owner, op, scope)?;

        return Ok(Vec::new());
    }

    if is_batch {
        return batch_table(site, item_writer, status, media, scope);
    }

    let shape = if is_list {
        list_shape(site.node)
    } else {
        ResponseShape::Item
    };

    body_response(item_writer, BodyMember::Item, status, &shape, media, scope)
}

// `responses` is written instead of `output` (and of a list's `item`), never beside them.
fn check_responses_alone(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let beside = RESPONSES_INSTEAD_OF
        .iter()
        .filter(|member| site.node.settings.contains_key(member));

    for member in beside {
        let pointer = pointer_below(&site.node.pointer, &[member]);
        let origin = scope
            .context
            .origin(&pointer)
            .unwrap_or_else(|| site.node.origin.clone());

        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::ResponsesOutput,
                origin: tree_nodes_node_origin(&origin)?,
                message: format!(
                    "The route {} writes both responses and {member}; responses replaces {member}.",
                    site.operation_id
                ),
                fix: format!(
                    "Move the {member} schema into a responses entry, or remove responses."
                ),
                related: Vec::new(),
            }));
    }

    Ok(())
}

// Each header name once, in any case (RFC 9110 section 5.1).
fn response_headers(
    site: &TreeNodesSite<'_, '_>,
    written: Option<&JsonValue>,
    pointer: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<ResponseHeader>, PassError> {
    let mut headers = Vec::new();
    let mut seen: HashMap<String, TreeNodesField> = HashMap::new();
    let read = tree_nodes_fields(site, written, pointer, &Direction::Output, scope)?;

    for field in read.fields {
        let name = field.name.to_lowercase();

        if let Some(first) = seen.get(&name) {
            report_header_twice(site, &field, first, scope)?;
            continue;
        }

        if !tree_nodes_field_travels(site, &field, "response header", scope)? {
            seen.insert(name, field);
            continue;
        }

        headers.push(ResponseHeader {
            name: field.name.clone(),
            r#type: field.field_type.clone(),
            required: field.required,
            origin: Some(field.origin.clone()),
            derived_from: None,
            semantic: None,
        });
        seen.insert(name, field);
    }

    Ok(headers)
}

// One entry of `responses`: its body, headers and docs; a redirect status with no body.
fn written_response(
    site: &TreeNodesSite<'_, '_>,
    status_key: &str,
    media: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Response, PassError> {
    let pointer = pointer_below(&site.node.pointer, &["responses", status_key]);
    let entry = tree_nodes_member(site.node.settings.get("responses"), status_key);
    let origin = scope
        .context
        .origin(&pointer)
        .unwrap_or_else(|| site.node.origin.clone());
    let Ok(status) = status_key.parse::<i64>() else {
        return Err(InternalError::new(format!(
            "the response key {status_key} at {} is no status",
            site.node.pointer
        ))
        .into());
    };
    let headers_pointer = format!("{pointer}/headers");
    let headers = response_headers(
        site,
        tree_nodes_member(entry, "headers"),
        &headers_pointer,
        scope,
    )?;
    let docs = docs_of(entry);
    let written_body = tree_nodes_member(entry, "body");

    if REDIRECT_STATUSES.contains(&status) {
        if written_body.is_some() {
            report_redirect_body(site, status, &format!("{pointer}/body"), scope)?;
        }

        return Ok(Response {
            status,
            media: None,
            body: None,
            shape: ResponseShape::Redirect,
            headers,
            origin: Some(origin),
            derived_from: None,
            docs,
        });
    }

    if written_body.is_none() {
        return Ok(Response {
            status,
            media: None,
            body: None,
            shape: ResponseShape::Empty,
            headers,
            origin: Some(origin),
            derived_from: None,
            docs,
        });
    }

    let body = tree_nodes_answered_use(
        scope.schemas,
        &format!("{pointer}/body"),
        &Direction::Output,
    )?;
    let is_file = matches!(body, TypeUse::File(_));

    Ok(Response {
        status,
        media: (!is_file).then(|| media.to_owned()),
        shape: if is_file {
            ResponseShape::Binary
        } else {
            ResponseShape::Item
        },
        body: Some(body),
        headers,
        origin: Some(origin),
        derived_from: None,
        docs,
    })
}

// The id-keyed table of the owner's items (`batch.read`).
fn batch_table(
    site: &TreeNodesSite<'_, '_>,
    item_writer: &TreeNode<'_>,
    status: i64,
    media: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Response>, PassError> {
    let body = tree_nodes_answered_use(
        scope.schemas,
        &pointer_below(&item_writer.pointer, &["item"]),
        &Direction::Output,
    )?;

    Ok(vec![Response {
        status,
        media: Some(media.to_owned()),
        body: Some(body),
        shape: ResponseShape::Table,
        headers: Vec::new(),
        origin: None,
        derived_from: Some(DerivedFrom {
            derivation: BATCH_DERIVATION,
            from: vec![site.node.origin.clone()],
        }),
        docs: None,
    }])
}

fn report_redirect_body(
    site: &TreeNodesSite<'_, '_>,
    status: i64,
    body_pointer: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let origin = scope
        .context
        .origin(body_pointer)
        .unwrap_or_else(|| site.node.origin.clone());

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::RedirectBody,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The {status} response of {} is a redirect, which has no body.",
                site.operation_id
            ),
            fix: "Remove the body; the compiler adds the Location header.".to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

fn report_no_item(
    site: &TreeNodesSite<'_, '_>,
    owner: &TreeNode<'_>,
    op: &OpShorthand,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::OpItem,
        origin: tree_nodes_node_origin(&site.node.origin)?,
        message: format!(
            "The {} op of {} answers its item, but {} declares no item.",
            op.as_str(),
            owner.name,
            owner.name
        ),
        fix: format!("Declare item on {}, or give the op an output.", owner.name),
        related: Vec::new(),
    });
    let key = format!("op-item:{}:{}", owner.pointer, op.as_str());

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(())
}

fn report_header_twice(
    _site: &TreeNodesSite<'_, '_>,
    _field: &TreeNodesField,
    _first: &TreeNodesField,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportHeaderTwice"))
}
