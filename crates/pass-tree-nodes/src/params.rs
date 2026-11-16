//! The `params` of an operation: path, query and header parameters, read from fields and checked against the path.

use std::collections::HashMap;

use seampact_diagnostics::{DiagnosticOrigin, InternalError, RelatedLocation};
use seampact_ir::{
    Direction, IgnoreUnknownQuery, KnownUnknownQuery, Origin, Param, Params, Reason,
    RefuseUnknownQuery, TypeUse, UnknownQuery,
};
use seampact_json::{JsonValue, stringify_json};
use seampact_pass_tree_shared::{tree_nodes_member, tree_nodes_tag_header};
use seampact_pipeline::{NearestSetting, OrderedSetting, PassError, TreeNodeId, TreeNodeKind};

use crate::api::text_of;
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_locate,
    tree_nodes_node_origin, tree_nodes_report_once,
};
use crate::fields::{
    TreeNodesField, TreeNodesFields, TreeNodesSite, tree_nodes_field_travels, tree_nodes_fields,
};
use crate::pass::TreeNodesScope;
use crate::paths::TreeNodesPath;

/// The three parameter lists of an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParamList {
    Path,
    Query,
    Header,
}

/// The inherited fields maps a route reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FieldsSetting {
    Query,
    Headers,
}

impl FieldsSetting {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Headers => "headers",
        }
    }

    const fn ordered(self) -> OrderedSetting {
        match self {
            Self::Query => OrderedSetting::Query,
            Self::Headers => OrderedSetting::Headers,
        }
    }
}

/// The `unknownQuery` policy value that refuses.
const REFUSE: &str = "refuse";

/// The names of the `{name}` placeholders of a text, in order, repeats included.
///
/// A name holds no brace; the TypeScript's `/\{([^{}]+)\}/g`.
pub(crate) fn placeholders_of(text: &str) -> Vec<&str> {
    let mut names = Vec::new();
    let mut rest = text;

    while let Some((_, after_open)) = rest.split_once('{') {
        let Some(close) = after_open.find(['{', '}']) else {
            break;
        };
        let (name, from_close) = after_open.split_at(close);

        match from_close.strip_prefix('}') {
            Some(after_close) if !name.is_empty() => {
                names.push(name);
                rest = after_close;
            }
            _ => rest = after_open,
        }
    }

    names
}

/// The policy for undeclared query keys: the nearest `unknownQuery`, else `conventions.query.unknownKeys`.
pub(crate) fn tree_nodes_unknown_query(
    site: &TreeNodesSite<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<UnknownQuery, InternalError> {
    let nearest = scope
        .context
        .inherited
        .nearest(site.node_id, &NearestSetting::UnknownQuery)?;

    if let Some(nearest) = nearest {
        return policy_of(Some(nearest.value), Some(&nearest.origin));
    }

    let reading = scope.context.conventions.get("query.unknownKeys")?;

    policy_of(
        reading.as_ref().map(|reading| reading.value),
        reading.as_ref().and_then(|reading| reading.origin.as_ref()),
    )
}
fn policy_of(
    value: Option<&JsonValue>,
    origin: Option<&Origin>,
) -> Result<UnknownQuery, InternalError> {
    if text_of(value) == Some(REFUSE) {
        return Ok(KnownUnknownQuery::Refuse(RefuseUnknownQuery {}).into());
    }

    let reason = text_of(tree_nodes_member(value, "ignore"));

    let (Some(reason), Some(origin)) = (reason, origin) else {
        return Err(InternalError::new(format!(
            "an unknown-query policy is refuse or {{ ignore: <reason> }}, got {}",
            value.map_or_else(|| "undefined".to_owned(), stringify_json)
        )));
    };

    Ok(KnownUnknownQuery::Ignore(IgnoreUnknownQuery {
        reason: Reason::new(reason.to_owned()),
        origin: origin.clone(),
    })
    .into())
}
// An inherited fields map (`query`, `headers`): each node that writes one, from the root down, kept by `reaches`.
fn inherited_fields(
    site: &TreeNodesSite<'_, '_>,
    setting: FieldsSetting,
    reaches: impl Fn(TreeNodeId) -> bool,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<TreeNodesField>, PassError> {
    let inherited = scope.context.inherited;
    let Some(entries) = inherited.ordered(site.node_id, setting.ordered())? else {
        return Ok(Vec::new());
    };
    let mut writers: Vec<TreeNodeId> = Vec::new();

    for entry in entries {
        if !writers.contains(&entry.node) && reaches(entry.node) {
            writers.push(entry.node);
        }
    }

    let mut fields = Vec::new();

    for writer in writers {
        let at = site.nodes.get(writer)?;
        let pointer = format!("{}/{}", at.pointer, setting.as_str());
        let read = tree_nodes_fields(
            site,
            at.settings.get(setting.as_str()),
            &pointer,
            &Direction::Input,
            scope,
        )?;

        fields.extend(read.fields);
    }

    Ok(fields)
}

// A header-tagged input adds its tag header itself (ADR 0003 section 4), so the route declares it no second time.
fn check_tag_header_not_declared(
    site: &TreeNodesSite<'_, '_>,
    headers: &[Param],
    input: Option<&TypeUse>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(tag_header) = tree_nodes_tag_header(scope.draft, input).map(str::to_lowercase) else {
        return Ok(());
    };
    let declared = headers
        .iter()
        .find(|header| header.name.to_lowercase() == tag_header);
    let Some((declared, declared_origin)) =
        declared.and_then(|header| Some((header, header.origin.as_ref()?)))
    else {
        return Ok(());
    };
    let fallback = tree_nodes_node_origin(&site.node.origin)?;
    let origin = tree_nodes_locate(declared_origin, &fallback);
    let key = format!(
        "union-header:{}#{}:{}",
        origin.layer, origin.pointer, site.node.pointer
    );
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::UnionHeader,
        origin,
        message: format!(
            "The request header {} of {} is the tag of its input union, which adds it.",
            declared.name, site.operation_id
        ),
        fix: "Remove the header; the union's discriminator adds it.".to_owned(),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(())
}

// Each field once per list (a header name in any case), with a type the service answers, and that may travel there.
fn params_of(
    site: &TreeNodesSite<'_, '_>,
    fields: &[TreeNodesField],
    list: ParamList,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<Param>, PassError> {
    let mut params: Vec<Param> = Vec::new();
    let mut seen: HashMap<String, &TreeNodesField> = HashMap::new();

    for field in fields {
        let key = if list == ParamList::Header {
            field.name.to_lowercase()
        } else {
            field.name.clone()
        };

        if let Some(first) = seen.get(&key) {
            report_twice(site, field, first, list, scope)?;
            continue;
        }

        seen.insert(key, field);

        if !tree_nodes_field_travels(site, field, place_of(list), scope)? {
            continue;
        }

        if let Some(param) = param_of(site, field, &field.field_type, list, scope)? {
            params.push(param);
        }
    }

    Ok(params)
}

/// How a message names each list.
fn place_of(list: ParamList) -> &'static str {
    match list {
        ParamList::Path => "path parameter",
        ParamList::Query => "query field",
        ParamList::Header => "request header",
    }
}

/// One route's declared parameters.
pub(crate) fn tree_nodes_params(
    site: &TreeNodesSite<'_, '_>,
    path: Option<&TreeNodesPath>,
    safe: bool,
    input: Option<&TypeUse>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Params, PassError> {
    let path_fields = path_param_fields(site, scope)?;

    if let Some(path) = path {
        check_placeholders(site, path, &path_fields, scope)?;
    }

    let header_fields = inherited_fields(site, FieldsSetting::Headers, |_| true, scope)?;
    let header = params_of(site, &header_fields, ParamList::Header, scope)?;

    check_tag_header_not_declared(site, &header, input, scope)?;

    let own_node = site.node_id;
    let query_fields = inherited_fields(
        site,
        FieldsSetting::Query,
        |at| at == own_node || safe,
        scope,
    )?;

    check_query_not_named_like_path(site, &path_fields.fields, &query_fields, scope)?;

    Ok(Params {
        path: params_of(site, &path_fields.fields, ParamList::Path, scope)?,
        query: params_of(site, &query_fields, ParamList::Query, scope)?,
        header,
    })
}

// Merged-bag frameworks read a path parameter and a query key of one name as one value, so a query field takes no
// path parameter's name (a stricter rule than the grammar's). Body and form fields may.
fn check_query_not_named_like_path(
    site: &TreeNodesSite<'_, '_>,
    path_fields: &[TreeNodesField],
    query_fields: &[TreeNodesField],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let fallback = tree_nodes_node_origin(&site.node.origin)?;

    for query in query_fields {
        let Some(path) = path_fields.iter().find(|field| field.name == query.name) else {
            continue;
        };
        let origin = tree_nodes_locate(&query.origin, &fallback);
        let key = format!(
            "param-unique:{}#{}:{}:path",
            origin.layer, origin.pointer, query.name
        );
        let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::ParamUnique,
            origin,
            message: format!(
                "The query field {} of {} has the name of its path parameter, which frameworks merging both read as one value.",
                query.name, site.operation_id
            ),
            fix: "Rename one of the two.".to_owned(),
            related: vec![RelatedLocation {
                origin: tree_nodes_locate(&path.origin, &fallback),
                message: "the path parameter".to_owned(),
            }],
        });

        tree_nodes_report_once(&key, diagnostic, scope);
    }

    Ok(())
}

// The member id of each collection whose member scope the route sits in, and each node's `pathParams`, from the
// surface down: the order the placeholders appear in the path.
fn path_param_fields(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<TreeNodesFields, PassError> {
    let mut fields: Vec<TreeNodesField> = Vec::new();
    let mut complete = true;

    for (_, at) in site.nodes.chain(site.node_id)? {
        let collection = match at.parent {
            Some(parent) if at.kind == TreeNodeKind::Scope && at.name == "member" => {
                Some(site.nodes.get(parent)?)
            }
            _ => None,
        };

        if let Some(collection) = collection {
            let id = tree_nodes_fields(
                site,
                collection.settings.get("id"),
                &format!("{}/id", collection.pointer),
                &Direction::Input,
                scope,
            )?;

            fields.extend(required(id.fields));
        }

        let declared = tree_nodes_fields(
            site,
            at.settings.get("pathParams"),
            &format!("{}/pathParams", at.pointer),
            &Direction::Input,
            scope,
        )?;

        complete = complete && declared.complete;
        fields.extend(required(declared.fields));
    }

    Ok(TreeNodesFields { fields, complete })
}

fn required(fields: Vec<TreeNodesField>) -> impl Iterator<Item = TreeNodesField> {
    fields.into_iter().map(|field| TreeNodesField {
        required: true,
        ..field
    })
}

// Every placeholder of the path names a path parameter, once, and every path parameter has its placeholder. A
// placeholder is reported where its path part is written, so a parent's path is reported once, not per route.
fn check_placeholders(
    site: &TreeNodesSite<'_, '_>,
    path: &TreeNodesPath,
    path_fields: &TreeNodesFields,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let node_origin = tree_nodes_node_origin(&site.node.origin)?;
    let mut placeholders: Vec<&str> = Vec::new();

    for part in &path.parts {
        for placeholder in placeholders_of(&part.text) {
            let origin = tree_nodes_locate(&part.origin, &node_origin);
            let repeated = placeholders.contains(&placeholder);

            placeholders.push(placeholder);

            if repeated {
                report_repeated_placeholder(site, &path.full, placeholder, &origin, scope);
            } else if path_fields.complete
                && !path_fields
                    .fields
                    .iter()
                    .any(|field| field.name == placeholder)
            {
                report_undeclared_placeholder(site, &path.full, placeholder, &origin, scope);
            }
        }
    }

    for field in path_fields
        .fields
        .iter()
        .filter(|field| !placeholders.contains(&field.name.as_str()))
    {
        let origin = tree_nodes_locate(&field.origin, &node_origin);
        let key = format!(
            "path-param:{}#{}:{}",
            origin.layer, origin.pointer, field.name
        );
        let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::PathParam,
            origin,
            message: format!(
                "The path parameter {} of {} is not in its path {}.",
                field.name, site.operation_id, path.full
            ),
            fix: format!(
                "Write {{{}}} in the path, or remove the parameter.",
                field.name
            ),
            related: Vec::new(),
        });

        tree_nodes_report_once(&key, diagnostic, scope);
    }

    Ok(())
}

// A query field carries its query wire and its default; one the service answers no wire for has no query
// encoding.
fn param_of(
    site: &TreeNodesSite<'_, '_>,
    field: &TreeNodesField,
    param_type: &TypeUse,
    list: ParamList,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Param>, PassError> {
    let param = Param {
        name: field.name.clone(),
        r#type: param_type.clone(),
        required: field.required,
        wire: None,
        default: None,
        origin: Some(field.origin.clone()),
        derived_from: None,
    };

    if list != ParamList::Query {
        return Ok(Some(param));
    }

    if let Some(wire) = scope.schemas.query_wire(&field.wire_pointer)? {
        // A default sits on an optional query field only; tree.schemas checks its value.
        let default = if field.required {
            None
        } else {
            field.default.clone()
        };

        return Ok(Some(Param {
            wire: Some(wire),
            default,
            ..param
        }));
    }

    let node_origin = tree_nodes_node_origin(&site.node.origin)?;
    let origin = tree_nodes_locate(&field.origin, &node_origin);
    let key = format!(
        "query-field:{}#{}:{}",
        origin.layer, origin.pointer, field.name
    );
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::QueryField,
        origin,
        message: format!(
            "The query field {} of {} has no query encoding.",
            field.name, site.operation_id
        ),
        fix: "Give the field a number, boolean, text, enum or list of them, or an object of them."
            .to_owned(),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(None)
}

fn report_undeclared_placeholder(
    site: &TreeNodesSite<'_, '_>,
    path: &str,
    placeholder: &str,
    origin: &DiagnosticOrigin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) {
    let key = format!(
        "path-param:{}#{}:{{{placeholder}}}",
        origin.layer, origin.pointer
    );
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::PathParam,
        origin: origin.clone(),
        message: format!(
            "The path {path} of {} holds {{{placeholder}}}, which no pathParams or id declares.",
            site.operation_id
        ),
        fix: format!("Declare {placeholder} in pathParams."),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);
}

fn report_twice(
    site: &TreeNodesSite<'_, '_>,
    field: &TreeNodesField,
    first: &TreeNodesField,
    list: ParamList,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    tree_nodes_report_declared_twice(site, field, first, place_of(list), scope)
}

/// Reports a field named twice in one list, once per place of the second declaration.
pub(crate) fn tree_nodes_report_declared_twice(
    site: &TreeNodesSite<'_, '_>,
    field: &TreeNodesField,
    first: &TreeNodesField,
    place: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let fallback = tree_nodes_node_origin(&site.node.origin)?;
    let origin = tree_nodes_locate(&field.origin, &fallback);
    let key = format!(
        "param-unique:{}#{}:{}",
        origin.layer, origin.pointer, field.name
    );
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::ParamUnique,
        origin,
        message: format!(
            "The {place} {} of {} is declared twice.",
            field.name, site.operation_id
        ),
        fix: "Remove one of the two declarations.".to_owned(),
        related: vec![RelatedLocation {
            origin: tree_nodes_locate(&first.origin, &fallback),
            message: "the first declaration".to_owned(),
        }],
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(())
}

fn report_repeated_placeholder(
    site: &TreeNodesSite<'_, '_>,
    path: &str,
    placeholder: &str,
    origin: &DiagnosticOrigin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) {
    let key = format!(
        "path-param:{}#{}:{{{placeholder}}}",
        origin.layer, origin.pointer
    );
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::PathParam,
        origin: origin.clone(),
        message: format!(
            "The path {path} of {} holds {{{placeholder}}} twice, so one parameter would fill two segments.",
            site.operation_id
        ),
        fix: "Rename one of the two placeholders and declare it.".to_owned(),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);
}

/// The text with each `{name}` placeholder written `{}`: a path compared by position only.
pub(crate) fn blank_placeholders(text: &str) -> String {
    let mut blanked = String::new();
    let mut rest = text;

    while let Some((before, after_open)) = rest.split_once('{') {
        blanked.push_str(before);

        let close = after_open.find(['{', '}']);
        let name_and_rest = close.map(|close| after_open.split_at(close));

        match name_and_rest
            .and_then(|(name, from_close)| Some((name, from_close.strip_prefix('}')?)))
        {
            Some((name, after_close)) if !name.is_empty() => {
                blanked.push_str("{}");
                rest = after_close;
            }
            _ => {
                blanked.push('{');
                rest = after_open;
            }
        }
    }

    blanked.push_str(rest);

    blanked
}
