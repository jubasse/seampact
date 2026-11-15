//! The `pagings` catalogue: every declared paging style, read and checked against its wire format.

use std::collections::HashSet;
use std::{iter, mem};

use seampact_diagnostics::{InternalError, RelatedLocation, quote_text};
use seampact_ir::{
    HandlerResultMember, NamedTemplate, Origin, PagingId, PagingLink, PagingParamPlacement,
    PagingParamStyle, PagingPosition, PagingRequestRole, PagingResponse, PagingRole, PagingStyle,
    Template, UrlRole, WireFormat,
};
use seampact_js::js_key_order;
use seampact_json::{JsonValue, stringify_json};
use seampact_pass_tree_shared::tree_nodes_member;
use seampact_pipeline::{PassError, pointer_below};
use seampact_templates::template_slots;

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::responses::TREE_NODES_PAGING_NONE;

use crate::formats::{tree_nodes_absent, tree_nodes_named_templates};
use crate::not_ported::not_ported_yet;
use crate::paging::number_of;
use crate::pass::TreeNodesScope;
use crate::templates::{
    TREE_NODES_RESPONSE_ROLES, TreeNodesTemplatePlace, TreeNodesTemplateSite, tree_nodes_template,
};

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
/// The slot that holds a page's records.
const ITEMS_SLOT: &str = "items";
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
/// Reads a declared style; `None` when it is refused (reported) or declared nowhere.
fn style_of(
    id: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<PagingStyle>, PassError> {
    let pointer = pointer_below("/pagings", &[id]);
    let raw = scope.context.raw;
    let declared = tree_nodes_member(raw.merged.get("pagings"), id);
    let origin = scope.context.origin(&pointer);
    let (Some(declared), Some(origin)) = (declared, origin) else {
        return Ok(None);
    };
    let mut reader = StyleReader::new(scope, id, &pointer);
    let request = reader.request(tree_nodes_member(Some(declared), "request"))?;
    let position = match &request {
        Some(request) => reader.position(request)?,
        None => None,
    };
    let response = reader.response(tree_nodes_member(Some(declared), "response"))?;
    let (Some(request), Some(position), Some(response)) = (request, position, response) else {
        return Ok(None);
    };
    let used = used_roles(&response)?;

    if !reader.check_kinds(&position, &used)? {
        return Ok(None);
    }

    Ok(Some(PagingStyle {
        id: PagingId::new(id.to_owned()),
        origin,
        handler_result: handler_result_of(&position, &used)?,
        position,
        absent: tree_nodes_absent(tree_nodes_member(Some(declared), "absent")),
        request,
        response,
    }))
}

// The response roles a style's templates and links write.
fn used_roles(response: &PagingResponse) -> Result<HashSet<String>, PassError> {
    let templates = response
        .body
        .iter()
        .chain(response.meta.iter().map(|member| &member.value))
        .chain(response.headers.iter().map(|header| &header.value));
    let mut roles = HashSet::new();

    for template in templates {
        roles.extend(template_slots(template)?.into_iter().map(|used| used.slot));
    }

    roles.extend(
        response
            .links
            .iter()
            .map(|link| link.role.as_str().to_owned()),
    );

    Ok(roles)
}

// The members the roles use, `total` for a role computed from it, `more` for a page or offset style that needs no
// total, and the value a cursor or since kind builds its next and previous URLs from.
fn handler_result_of(
    position: &PagingPosition,
    used: &HashSet<String>,
) -> Result<Vec<HandlerResultMember>, PassError> {
    let mut members: HashSet<&str> = used.iter().map(String::as_str).collect();
    let needs_total = TOTAL_ROLES.iter().any(|role| used.contains(*role));

    if needs_total {
        members.insert(HandlerResultMember::Total.as_str());
    }

    if !needs_total && matches!(position, PagingPosition::Page | PagingPosition::Offset) {
        members.insert(HandlerResultMember::More.as_str());
    }

    let Some((_, url_results)) = URL_ROLE_RESULTS.iter().find(|(kind, _)| kind == position) else {
        return Err(InternalError::new(format!(
            "no URL role results for the paging position {position}"
        ))
        .into());
    };

    for (role, member) in *url_results {
        if used.contains(*role) {
            members.insert(member.as_str());
        }
    }

    Ok(HANDLER_RESULT
        .iter()
        .filter(|member| members.contains(member.as_str()))
        .cloned()
        .collect())
}

#[allow(
    clippy::unused_self,
    reason = "stubs read nothing until the half's last brief"
)]
impl<'scope, 'draft, 'half, 'run> StyleReader<'scope, 'draft, 'half, 'run> {
    fn new(
        scope: &'scope mut TreeNodesScope<'draft, 'half, 'run>,
        id: &str,
        pointer: &str,
    ) -> Self {
        Self {
            scope,
            id: id.to_owned(),
            pointer: pointer.to_owned(),
        }
    }

    fn request(
        &mut self,
        written: Option<&JsonValue>,
    ) -> Result<Option<Vec<PagingRequestRole>>, PassError> {
        let Some(JsonValue::Object(written)) = written else {
            return Ok(Some(Vec::new()));
        };
        let mut roles = Vec::new();
        let mut sent = HashSet::new();
        let mut refused = false;

        for (name, place) in js_key_order(written.iter()) {
            let role = self.request_role(name, place)?;

            match role {
                Some(role) if self.check_sent_once(&role, &mut sent)? => roles.push(role),
                _ => refused = true,
            }
        }

        Ok((!refused).then_some(roles))
    }

    // Two request roles naming one parameter or header could not be told apart.
    fn check_sent_once(
        &mut self,
        role: &PagingRequestRole,
        sent: &mut HashSet<String>,
    ) -> Result<bool, PassError> {
        let names: Vec<&str> = iter::once(role.name.as_str())
            .chain(role.direction.as_deref())
            .collect();
        let twice = names.iter().enumerate().find_map(|(index, name)| {
            let repeated = sent.contains(&sent_key(&role.r#in, name))
                || names.iter().position(|other| other == name) < Some(index);

            repeated.then_some(*name)
        });

        for name in &names {
            sent.insert(sent_key(&role.r#in, name));
        }

        let Some(twice) = twice else {
            return Ok(true);
        };
        let placement = if role.r#in == PagingParamPlacement::Header {
            "header"
        } else {
            "query parameter"
        };

        self.refuse_request(
            &pointer_below(&self.pointer, &["request", role.role.as_str()]),
            &format!(
                "its {} role sends the {placement} {}, which another role sends too",
                role.role.as_str(),
                quote_text(twice)
            ),
            &format!("Give each request role its own {placement}."),
        )?;

        Ok(false)
    }

    fn request_role(
        &mut self,
        name: &str,
        place: &JsonValue,
    ) -> Result<Option<PagingRequestRole>, PassError> {
        let pointer = pointer_below(&self.pointer, &["request", name]);
        let Some(role) = REQUEST_ROLES
            .iter()
            .find(|candidate| candidate.as_str() == name)
        else {
            let names: Vec<&str> = REQUEST_ROLES.iter().map(PagingRole::as_str).collect();

            return Err(InternalError::new(format!(
                "the paging role at {pointer} is none of {}",
                names.join(", ")
            ))
            .into());
        };
        let placed = PLACEMENTS.iter().find_map(|candidate| {
            match tree_nodes_member(Some(place), candidate.as_str()) {
                Some(JsonValue::String(parameter)) => Some((candidate, parameter)),
                _ => None,
            }
        });
        let Some((placement, parameter)) = placed else {
            self.refuse_request(
                &pointer,
                &format!(
                    "its {} role names no query parameter or header",
                    role.as_str()
                ),
                "Write query or header on the role.",
            )?;

            return Ok(None);
        };
        let base = tree_nodes_member(Some(place), "base");
        let style = match tree_nodes_member(Some(place), "style") {
            Some(JsonValue::String(text)) => SORT_STYLES
                .iter()
                .find(|candidate| candidate.as_str() == text),
            _ => None,
        };
        let direction = tree_nodes_member(Some(place), "direction");

        if *role == PagingRole::Sort && !self.check_sort(&pointer, parameter, style, direction)? {
            return Ok(None);
        }

        Ok(Some(PagingRequestRole {
            role: role.clone(),
            r#in: placement.clone(),
            name: parameter.clone(),
            base: if *role == PagingRole::Page {
                Some(number_of(base)?.unwrap_or(DEFAULT_PAGE_BASE))
            } else {
                None
            },
            style: if *role == PagingRole::Sort {
                Some(style.cloned().unwrap_or(TREE_NODES_DEFAULT_SORT_STYLE))
            } else {
                None
            },
            direction: match direction {
                Some(JsonValue::String(text)) => Some(text.clone()),
                _ => None,
            },
        }))
    }

    // `split` names its direction parameter, and only it does; `keyed` holds `{key}` in its name.
    fn check_sort(
        &mut self,
        pointer: &str,
        parameter: &str,
        style: Option<&PagingParamStyle>,
        direction: Option<&JsonValue>,
    ) -> Result<bool, PassError> {
        let Some(fault) = sort_fault(parameter, style, direction) else {
            return Ok(true);
        };

        self.refuse_request(pointer, &fault.why, &fault.fix)?;

        Ok(false)
    }

    fn refuse_request(&mut self, _pointer: &str, _why: &str, _fix: &str) -> Result<(), PassError> {
        Err(not_ported_yet("StyleReader.refuseRequest"))
    }

    // Exactly one position role, or the pair `after` and `before`, which is a cursor kind.
    fn position(
        &mut self,
        request: &[PagingRequestRole],
    ) -> Result<Option<PagingPosition>, PassError> {
        let has = |name: &str| request.iter().any(|entry| entry.role.as_str() == name);
        let pair = has(PagingRole::After.as_str()) || has(PagingRole::Before.as_str());
        let positions: Vec<&PagingPosition> = POSITION_ROLES
            .iter()
            .filter(|position| has(position.as_str()))
            .collect();

        if pair
            && has(PagingRole::After.as_str())
            && has(PagingRole::Before.as_str())
            && positions.is_empty()
        {
            return Ok(Some(PagingPosition::Cursor));
        }

        if let (false, [only]) = (pair, positions.as_slice()) {
            return Ok(Some((*only).clone()));
        }

        self.report(
            StyleRule::Position,
            &pointer_below(&self.pointer, &["request"]),
            &format!(
                "The paging style {} writes no single position role.",
                self.id
            ),
            "Write exactly one of cursor, page, offset and since, or the pair after and before.",
        )?;

        Ok(None)
    }

    fn response(
        &mut self,
        written: Option<&JsonValue>,
    ) -> Result<Option<PagingResponse>, PassError> {
        let pointer = pointer_below(&self.pointer, &["response"]);
        let written_body = tree_nodes_member(written, "body");
        let body = match written_body {
            None => None,
            Some(written_body) => tree_nodes_template(
                &self.site(TreeNodesTemplatePlace::PagingBody),
                written_body,
                &format!("{pointer}/body"),
                self.scope,
            )?,
        };
        let meta = self.meta(
            tree_nodes_member(written, "meta"),
            &format!("{pointer}/meta"),
        )?;
        let headers = tree_nodes_named_templates(
            &self.site(TreeNodesTemplatePlace::PagingMember).owner,
            TreeNodesTemplatePlace::PagingMember,
            tree_nodes_member(written, "headers"),
            &format!("{pointer}/headers"),
            self.scope,
        )?;
        let links = self.links(
            tree_nodes_member(written, "links"),
            &format!("{pointer}/links"),
        )?;
        let (Some(meta), Some(headers)) = (meta, headers) else {
            return Ok(None);
        };

        if written_body.is_some() && body.is_none() {
            return Ok(None);
        }

        let Some(links) = links else {
            return Ok(None);
        };

        if let Some(body) = &body
            && !self.check_items_once(body, &format!("{pointer}/body"))?
        {
            return Ok(None);
        }

        Ok(Some(PagingResponse {
            body,
            meta,
            headers,
            links,
        }))
    }

    fn meta(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<Vec<NamedTemplate>>, PassError> {
        let owner = format!("the paging style {}", self.id);
        let templates = tree_nodes_named_templates(
            &owner,
            TreeNodesTemplatePlace::PagingMember,
            written,
            pointer,
            self.scope,
        )?;

        Ok(templates.map(|templates| {
            templates
                .into_iter()
                .map(|template| NamedTemplate {
                    name: template.name,
                    value: template.value,
                })
                .collect()
        }))
    }

    // Each link is one URL role, written as its slot (`next: $next`).
    fn links(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<Vec<PagingLink>>, PassError> {
        let Some(JsonValue::Object(written)) = written else {
            return Ok(Some(Vec::new()));
        };
        let mut links = Vec::new();
        let mut refused = false;

        for (rel, value) in js_key_order(written.iter()) {
            let role = URL_ROLES.iter().find(|candidate| {
                matches!(value, JsonValue::String(text) if text.strip_prefix('$') == Some(candidate.as_str()))
            });

            if let Some(role) = role {
                links.push(PagingLink {
                    rel: rel.clone(),
                    role: role.clone(),
                });

                continue;
            }

            refused = true;

            let written_roles: Vec<String> = URL_ROLES
                .iter()
                .map(|candidate| format!("${}", candidate.as_str()))
                .collect();

            self.report(
                StyleRule::Link,
                &pointer_below(pointer, &[rel]),
                &format!(
                    "The link {} of the paging style {} is no URL role.",
                    quote_text(rel),
                    self.id
                ),
                &format!("Write one of {}.", written_roles.join(", ")),
            )?;
        }

        Ok((!refused).then_some(links))
    }

    fn check_items_once(&mut self, body: &Template, pointer: &str) -> Result<bool, PassError> {
        let count = template_slots(body)?
            .iter()
            .filter(|used| used.slot == ITEMS_SLOT)
            .count();

        if count == 1 {
            return Ok(true);
        }

        let times = if count == 0 {
            "nowhere".to_owned()
        } else {
            format!("{count} times")
        };

        self.report(
            StyleRule::Items,
            pointer,
            &format!(
                "The page body of the paging style {} writes ${ITEMS_SLOT} {times}.",
                self.id
            ),
            "Write $items exactly once in response.body.",
        )?;

        Ok(false)
    }

    // A role used outside its kinds is a compile error naming the style.
    fn check_kinds(
        &mut self,
        position: &PagingPosition,
        used: &HashSet<String>,
    ) -> Result<bool, PassError> {
        let mut outside = 0_usize;

        for role in TREE_NODES_RESPONSE_ROLES {
            let Some((_, kinds)) = ROLE_KINDS.iter().find(|(name, _)| name == role) else {
                continue;
            };

            if !used.contains(*role) || kinds.contains(position) {
                continue;
            }

            let names: Vec<&str> = kinds.iter().map(PagingPosition::as_str).collect();

            outside += 1;
            self.report(
                StyleRule::Role,
                &pointer_below(&self.pointer, &["response"]),
                &format!(
                    "The paging style {} pages by {}, but writes the role ${role}, which only {} styles fill.",
                    self.id,
                    position.as_str(),
                    names.join(", ")
                ),
                &format!("Remove ${role}, or page by {}.", names.join(" or ")),
            )?;
        }

        Ok(outside == 0)
    }

    fn site(&self, place: TreeNodesTemplatePlace) -> TreeNodesTemplateSite {
        TreeNodesTemplateSite {
            place,
            owner: format!("the paging style {}", self.id),
        }
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
    parameter: &str,
    style: Option<&PagingParamStyle>,
    direction: Option<&JsonValue>,
) -> Option<SortFault> {
    let is_split = style == Some(&SPLIT_STYLE);

    if is_split && !matches!(direction, Some(JsonValue::String(_))) {
        return Some(SortFault {
            why: "its split sort names no direction parameter".to_owned(),
            fix: "Write direction on the sort role.".to_owned(),
        });
    }

    if !is_split && direction.is_some() {
        return Some(SortFault {
            why: "its sort names a direction parameter, which only style: split reads".to_owned(),
            fix: "Remove direction, or write style: split.".to_owned(),
        });
    }

    if style == Some(&KEYED_STYLE) && !parameter.contains(KEY_PLACEHOLDER) {
        return Some(SortFault {
            why: format!(
                "its keyed sort parameter {} holds no {KEY_PLACEHOLDER}",
                quote_text(parameter)
            ),
            fix: format!(
                "Write {KEY_PLACEHOLDER} in the parameter name, as order[{KEY_PLACEHOLDER}]."
            ),
        });
    }

    None
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
