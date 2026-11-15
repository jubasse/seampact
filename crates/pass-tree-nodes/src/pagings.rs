//! The `pagings` catalogue: every declared paging style, read and checked against its wire format.

use std::collections::HashSet;
use std::mem;

use seampact_diagnostics::InternalError;
use seampact_diagnostics::RelatedLocation;
use seampact_ir::{
    HandlerResultMember, NamedTemplate, Origin, PagingId, PagingLink, PagingParamPlacement,
    PagingParamStyle, PagingPosition, PagingRequestRole, PagingResponse, PagingRole, PagingStyle,
    Template, UrlRole, WireFormat,
};
use seampact_js::js_key_order;
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{PassError, pointer_below};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::responses::TREE_NODES_PAGING_NONE;

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;
use crate::templates::{TreeNodesTemplatePlace, TreeNodesTemplateSite};

const POSITION_ROLES: &[PagingPosition] = &[
    PagingPosition::Cursor,
    PagingPosition::Page,
    PagingPosition::Offset,
    PagingPosition::Since,
];
const REQUEST_ROLES: &[PagingRole] = &[
    PagingRole::Cursor,
    PagingRole::After,
    PagingRole::Before,
    PagingRole::Page,
    PagingRole::Offset,
    PagingRole::Since,
    PagingRole::Limit,
    PagingRole::Sort,
];
const PLACEMENTS: &[PagingParamPlacement] =
    &[PagingParamPlacement::Query, PagingParamPlacement::Header];
const SORT_STYLES: &[PagingParamStyle] = &[
    PagingParamStyle::Signed,
    PagingParamStyle::Pair,
    PagingParamStyle::Keyed,
    PagingParamStyle::Split,
];
/// A sort role without `style` sends `sort=-createdAt,title`.
pub(crate) const TREE_NODES_DEFAULT_SORT_STYLE: PagingParamStyle = PagingParamStyle::Signed;
const URL_ROLES: &[UrlRole] = &[
    UrlRole::SelfLink,
    UrlRole::First,
    UrlRole::Previous,
    UrlRole::Next,
    UrlRole::Last,
];
const HANDLER_RESULT: &[HandlerResultMember] = &[
    HandlerResultMember::NextCursor,
    HandlerResultMember::PreviousCursor,
    HandlerResultMember::Total,
    HandlerResultMember::More,
    HandlerResultMember::NextSince,
    HandlerResultMember::Complete,
];
/// `page` counts from 1 unless `base` says 0.
const DEFAULT_PAGE_BASE: i64 = 1;
const SPLIT_STYLE: PagingParamStyle = PagingParamStyle::Split;
const KEYED_STYLE: PagingParamStyle = PagingParamStyle::Keyed;
const KEY_PLACEHOLDER: &str = "{key}";
/// The kinds each response role belongs to; a role left out belongs to every kind. A since kind has no previous
/// token, so it builds no `previous` URL.
const ROLE_KINDS: &[(&str, &[PagingPosition])] = &[
    ("nextCursor", &[PagingPosition::Cursor]),
    ("previousCursor", &[PagingPosition::Cursor]),
    ("page", &[PagingPosition::Page, PagingPosition::Offset]),
    ("offset", &[PagingPosition::Page, PagingPosition::Offset]),
    ("from", &[PagingPosition::Page, PagingPosition::Offset]),
    ("to", &[PagingPosition::Page, PagingPosition::Offset]),
    (
        "total",
        &[
            PagingPosition::Cursor,
            PagingPosition::Page,
            PagingPosition::Offset,
        ],
    ),
    (
        "totalPages",
        &[PagingPosition::Page, PagingPosition::Offset],
    ),
    (
        "previous",
        &[
            PagingPosition::Cursor,
            PagingPosition::Page,
            PagingPosition::Offset,
        ],
    ),
    ("last", &[PagingPosition::Page, PagingPosition::Offset]),
    ("nextSince", &[PagingPosition::Since]),
    ("complete", &[PagingPosition::Since]),
];
/// The roles that make the handler return the total.
const TOTAL_ROLES: &[&str] = &["total", "totalPages", "last"];
/// The URL roles a cursor or since kind builds from a value the handler returns.
const URL_ROLE_RESULTS: &[(PagingPosition, &[(&str, HandlerResultMember)])] = &[
    (
        PagingPosition::Cursor,
        &[
            ("next", HandlerResultMember::NextCursor),
            ("previous", HandlerResultMember::PreviousCursor),
        ],
    ),
    (
        PagingPosition::Since,
        &[("next", HandlerResultMember::NextSince)],
    ),
    (PagingPosition::Page, &[]),
    (PagingPosition::Offset, &[]),
];

/// Reads one paging style from the merged raw tree and reports what it refuses.
pub(crate) struct StyleReader<'scope, 'draft, 'half, 'run> {
    pub(crate) scope: &'scope mut TreeNodesScope<'draft, 'half, 'run>,
    pub(crate) id: String,
    pub(crate) pointer: String,
}

/// A sort role the style refuses, with how to fix it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SortFault {
    why: String,
    fix: String,
}

/// The rules a style reader reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StyleRule {
    Request,
    Position,
    Items,
    Role,
    Link,
}

/// Writes `pagings`: every declared style, used or not, but the reserved `none`.
pub(crate) fn tree_nodes_pagings(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    refuse_reserved_style(scope)?;

    if let Some(JsonValue::Object(declared)) = scope.context.raw.merged.get("pagings") {
        for (id, _) in
            js_key_order(declared.iter()).filter(|(name, _)| *name != TREE_NODES_PAGING_NONE)
        {
            if let Some(style) = style_of(id, scope)? {
                scope
                    .output
                    .pagings
                    .insert(PagingId::new(id.clone()), style);
            }
        }
    }

    check_formats(scope)
}
// `none` names an unpaged list, never a style.
fn refuse_reserved_style(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), InternalError> {
    let pointer = pointer_below("/pagings", &[TREE_NODES_PAGING_NONE]);
    let Some(origin) = scope.context.origin(&pointer) else {
        return Ok(());
    };

    scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::PagingReserved,
        origin: tree_nodes_node_origin(&origin)?,
        message: format!(
            "The paging style name {TREE_NODES_PAGING_NONE} is reserved for a list served whole."
        ),
        fix: format!("Rename the style {TREE_NODES_PAGING_NONE}."),
        related: Vec::new(),
    }));

    Ok(())
}
fn style_of(
    _id: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<PagingStyle>, PassError> {
    Err(not_ported_yet("styleOf"))
}

fn used_roles(_response: &PagingResponse) -> Result<HashSet<String>, PassError> {
    Err(not_ported_yet("usedRoles"))
}

fn handler_result_of(
    _position: &PagingPosition,
    _used: &HashSet<String>,
) -> Result<Vec<HandlerResultMember>, PassError> {
    Err(not_ported_yet("handlerResultOf"))
}

#[allow(
    clippy::unused_self,
    reason = "stubs read nothing until the half's last brief"
)]
impl<'scope, 'draft, 'half, 'run> StyleReader<'scope, 'draft, 'half, 'run> {
    fn new(
        _scope: &'scope mut TreeNodesScope<'draft, 'half, 'run>,
        _id: &str,
        _pointer: &str,
    ) -> Result<Self, PassError> {
        Err(not_ported_yet("StyleReader.constructor"))
    }

    fn request(
        &mut self,
        _written: Option<&JsonValue>,
    ) -> Result<Option<Vec<PagingRequestRole>>, PassError> {
        Err(not_ported_yet("StyleReader.request"))
    }

    fn check_sent_once(
        &mut self,
        _role: &PagingRequestRole,
        _sent: &mut HashSet<String>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("StyleReader.checkSentOnce"))
    }

    fn request_role(
        &mut self,
        _name: &str,
        _place: &JsonValue,
    ) -> Result<Option<PagingRequestRole>, PassError> {
        Err(not_ported_yet("StyleReader.requestRole"))
    }

    fn check_sort(
        &mut self,
        _pointer: &str,
        _parameter: &str,
        _style: Option<&PagingParamStyle>,
        _direction: Option<&JsonValue>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("StyleReader.checkSort"))
    }

    fn refuse_request(&mut self, _pointer: &str, _why: &str, _fix: &str) -> Result<(), PassError> {
        Err(not_ported_yet("StyleReader.refuseRequest"))
    }

    fn position(
        &mut self,
        _request: &[PagingRequestRole],
    ) -> Result<Option<PagingPosition>, PassError> {
        Err(not_ported_yet("StyleReader.position"))
    }

    fn response(
        &mut self,
        _written: Option<&JsonValue>,
    ) -> Result<Option<PagingResponse>, PassError> {
        Err(not_ported_yet("StyleReader.response"))
    }

    fn meta(
        &mut self,
        _written: Option<&JsonValue>,
        _pointer: &str,
    ) -> Result<Option<Vec<NamedTemplate>>, PassError> {
        Err(not_ported_yet("StyleReader.meta"))
    }

    fn links(
        &mut self,
        _written: Option<&JsonValue>,
        _pointer: &str,
    ) -> Result<Option<Vec<PagingLink>>, PassError> {
        Err(not_ported_yet("StyleReader.links"))
    }

    fn check_items_once(&mut self, _body: &Template, _pointer: &str) -> Result<bool, PassError> {
        Err(not_ported_yet("StyleReader.checkItemsOnce"))
    }

    fn check_kinds(
        &mut self,
        _position: &PagingPosition,
        _used: &HashSet<String>,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("StyleReader.checkKinds"))
    }

    fn site(&self, _place: TreeNodesTemplatePlace) -> Result<TreeNodesTemplateSite, PassError> {
        Err(not_ported_yet("StyleReader.site"))
    }

    fn report(
        &mut self,
        _rule: StyleRule,
        _pointer: &str,
        _message: &str,
        _fix: &str,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("StyleReader.report"))
    }
}

fn sort_fault(
    _parameter: &str,
    _style: Option<&PagingParamStyle>,
    _direction: Option<&JsonValue>,
) -> Result<Option<SortFault>, PassError> {
    Err(not_ported_yet("sortFault"))
}

fn check_meta(
    _style: &PagingStyle,
    _format: &WireFormat,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkMeta"))
}

fn format_related(
    _format: &WireFormat,
    _origin: Option<&Origin>,
    _message: &str,
) -> Result<Vec<RelatedLocation>, PassError> {
    Err(not_ported_yet("formatRelated"))
}

// Header names are case-insensitive (RFC 9110 section 5.1); query parameter names are not.
pub(crate) fn sent_key(placement: &PagingParamPlacement, name: &str) -> String {
    let sent_name = if *placement == PagingParamPlacement::Header {
        name.to_lowercase()
    } else {
        name.to_owned()
    };

    stringify_json(&JsonValue::Array(vec![
        JsonValue::String(placement.as_str().to_owned()),
        JsonValue::String(sent_name),
    ]))
}
// A style adding `meta` needs a format page that writes `$meta`, and the style and the format name no meta
// member twice. Each pair of a style and a format is checked once.
fn check_formats(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    let operations = mem::take(&mut scope.output.operations);
    let pagings = mem::take(&mut scope.output.pagings);
    let formats = mem::take(&mut scope.output.formats);
    let mut checked: HashSet<String> = HashSet::new();

    for operation in &operations {
        let style_id = operation
            .paging
            .as_ref()
            .and_then(|paging| paging.style.as_ref());
        let (Some(style_id), Some(format_id)) = (style_id, operation.format.as_ref()) else {
            continue;
        };

        let (Some(style), Some(format)) = (pagings.get(style_id), formats.get(format_id)) else {
            continue;
        };
        let pair = stringify_json(&JsonValue::Array(vec![
            JsonValue::String(style_id.as_ref().to_owned()),
            JsonValue::String(format_id.as_ref().to_owned()),
        ]));

        if !checked.insert(pair) {
            continue;
        }

        if style.response.body.is_none() && !style.response.meta.is_empty() {
            check_meta(style, format, scope)?;
        }
    }

    scope.output.operations = operations;
    scope.output.pagings = pagings;
    scope.output.formats = formats;

    Ok(())
}
