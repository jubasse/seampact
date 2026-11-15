//! Who owns an operation and the concurrency token it carries, inherited from its resource.

use seampact_diagnostics::{InternalError, RelatedLocation};
use seampact_ir::{
    OpShorthand, Origin, Owner, OwnerKind, Param, Params, TypeUse, ValueSource, ValueSourceIn,
};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{
    TREE_NODES_DELETE_OP, tree_nodes_member, tree_nodes_object_of, tree_nodes_op_owner,
    tree_nodes_op_shorthand, tree_nodes_setting, tree_nodes_text,
};
use seampact_pipeline::{DraftConcurrency, PassError, TreeNode, TreeNodeKind, TreeNodes};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once,
};
use crate::fields::TreeNodesSite;
use crate::pass::TreeNodesScope;

const OWNER_CALLER: OwnerKind = OwnerKind::Caller;
/// The value of `concurrency` that inherits the resource's.
const INHERIT: &str = "inherit";
/// The ops that inherit the resource's concurrency.
/// The name of the scope that holds a collection's member routes.
const MEMBER_SCOPE: &str = "member";
/// The characters a regular expression `.` does not match.
const LINE_TERMINATORS: [char; 4] = ['\n', '\r', '\u{2028}', '\u{2029}'];
const VERSIONED_OPS: &[OpShorthand] = &[OpShorthand::Update, OpShorthand::Delete];

/// Where the concurrency version is carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VersionPlace {
    Body,
    Query,
    Header,
}

impl VersionPlace {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Body => "body",
            Self::Query => "query",
            Self::Header => "header",
        }
    }

    const fn value_source_in(self) -> ValueSourceIn {
        match self {
            Self::Body => ValueSourceIn::Body,
            Self::Query => ValueSourceIn::Query,
            Self::Header => ValueSourceIn::Header,
        }
    }
}

/// The place and name a concurrency version is read from.
#[derive(Debug, Clone, PartialEq, Eq)]
struct VersionSource {
    place: VersionPlace,
    name: String,
}

// A caller-owned record has no version. That `field` names an item property is tree.schemas' check, made
// where it adds the version.
fn check_declaration(
    resource: Option<&TreeNode<'_>>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(resource) = resource else {
        return Ok(());
    };

    if !resource.settings.contains_key("concurrency") {
        return Ok(());
    }

    check_owner_alone(resource, scope)
}
/// The collection or single an operation writes: the owner of its op, else its nearest one.
fn resource_node_of<'nodes, 'raw>(
    node: &TreeNode<'raw>,
    nodes: &'nodes TreeNodes<'raw>,
) -> Result<Option<&'nodes TreeNode<'raw>>, InternalError> {
    if node.kind == TreeNodeKind::Op {
        return tree_nodes_op_owner(nodes, node);
    }

    let mut at = node.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;

        if matches!(
            current.kind,
            TreeNodeKind::Collection | TreeNodeKind::Single
        ) {
            return Ok(Some(current));
        }

        at = current.parent;
    }

    Ok(None)
}
/// `owner: caller`, written on the collection or single the operation belongs to.
pub(crate) fn tree_nodes_owner(
    site: &TreeNodesSite<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Owner>, PassError> {
    let Some(resource) = resource_node_of(site.node, site.nodes)? else {
        return Ok(None);
    };

    if tree_nodes_text(resource, "owner") != Some(OWNER_CALLER.as_str()) {
        return Ok(None);
    }

    let pointer = format!("{}/owner", resource.pointer);
    let Some(origin) = scope.context.origin(&pointer) else {
        return Err(InternalError::new(format!("the raw tree has no origin for {pointer}")).into());
    };

    Ok(Some(Owner {
        kind: OWNER_CALLER,
        origin,
    }))
}

/// The version an operation compares: its resource's `concurrency`, for an `update` or `delete` op, and for
/// a member route with `concurrency: inherit`. A delete without input reads a body source from the query.
pub(crate) fn tree_nodes_concurrency(
    site: &TreeNodesSite<'_, '_>,
    input: Option<&TypeUse>,
    params: &Params,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftConcurrency>, PassError> {
    let node = site.node;
    let op = tree_nodes_op_shorthand(node);
    let opts_in = tree_nodes_text(node, "concurrency") == Some(INHERIT);
    let resource = resource_node_of(node, site.nodes)?;

    check_declaration(resource, scope)?;

    if op.as_ref().is_some_and(|op| !VERSIONED_OPS.contains(op)) {
        return Ok(None);
    }

    if op.is_none() && !opts_in {
        return Ok(None);
    }

    let declared = resource.and_then(|resource| tree_nodes_setting(resource, "concurrency"));
    let (Some(resource), Some(declared)) = (resource, declared) else {
        if opts_in {
            report_nothing_to_inherit(site, "declares no concurrency", scope)?;
        }

        return Ok(None);
    };

    if opts_in && !on_member_scope(node, resource, site.nodes)? {
        report_nothing_to_inherit(site, "is not a member route of a collection", scope)?;

        return Ok(None);
    }

    let source = parse_source(tree_nodes_member(Some(declared), "version"));
    let field = tree_nodes_member(Some(declared), "field");
    let (Some(source), Some(JsonValue::String(field))) = (source, field) else {
        return Err(InternalError::new(format!(
            "the concurrency of {} has no version and field the grammar admits",
            resource.pointer
        ))
        .into());
    };

    check_not_restated(site, &source, input, params, scope)?;

    let reads_body_without_one = source.place == VersionPlace::Body
        && op.as_ref() == Some(&TREE_NODES_DELETE_OP)
        && input.is_none();
    let place = if reads_body_without_one {
        VersionPlace::Query
    } else {
        source.place
    };

    Ok(Some(DraftConcurrency {
        version: ValueSource {
            r#in: place.value_source_in(),
            name: Some(source.name),
            prefix_bits: None,
        },
        field: field.clone(),
        derived_from: None,
    }))
}

fn origin_of(site: &TreeNodesSite<'_, '_>, param: Option<&Param>) -> Option<Origin> {
    param.map(|param| {
        param
            .origin
            .clone()
            .unwrap_or_else(|| site.node.origin.clone())
    })
}

fn check_owner_alone(
    resource: &TreeNode<'_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if tree_nodes_text(resource, "owner") != Some(OWNER_CALLER.as_str()) {
        return Ok(());
    }

    let origin_of_member = |member: &str, scope: &TreeNodesScope<'_, '_, '_>| {
        let origin = scope
            .context
            .origin(&format!("{}/{member}", resource.pointer))
            .unwrap_or_else(|| resource.origin.clone());

        tree_nodes_node_origin(&origin)
    };
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::OwnerConcurrency,
        origin: origin_of_member("concurrency", scope)?,
        message: format!(
            "{} is owned by the caller and also declares concurrency; a caller-owned record has no version.",
            resource.name
        ),
        fix: "Remove concurrency, or remove owner: caller.".to_owned(),
        related: vec![RelatedLocation {
            origin: origin_of_member("owner", scope)?,
            message: "owner: caller".to_owned(),
        }],
    });

    tree_nodes_report_once(
        &format!("owner-concurrency:{}", resource.pointer),
        diagnostic,
        scope,
    );

    Ok(())
}

// A concurrency source is `body.<name>`, `query.<name>` or `header.<name>`.
fn parse_source(written: Option<&JsonValue>) -> Option<VersionSource> {
    let Some(JsonValue::String(text)) = written else {
        return None;
    };
    let (place, name) = text.split_once('.')?;
    let place = match place {
        "body" => VersionPlace::Body,
        "query" => VersionPlace::Query,
        "header" => VersionPlace::Header,
        _ => return None,
    };

    // The name is `.+`: one or more characters, none a line terminator.
    if name.is_empty() || name.contains(LINE_TERMINATORS) {
        return None;
    }

    Some(VersionSource {
        place,
        name: name.to_owned(),
    })
}

// A collection's member routes take its version; a single's routes are its own members.
fn on_member_scope(
    node: &TreeNode<'_>,
    resource: &TreeNode<'_>,
    nodes: &TreeNodes<'_>,
) -> Result<bool, InternalError> {
    if resource.kind == TreeNodeKind::Single {
        return Ok(true);
    }

    let mut at = node.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;

        if current.pointer == resource.pointer {
            break;
        }

        if current.kind == TreeNodeKind::Scope
            && let Some(parent_id) = current.parent
            && nodes.get(parent_id)?.pointer == resource.pointer
        {
            return Ok(current.name == MEMBER_SCOPE);
        }

        at = current.parent;
    }

    Ok(false)
}

// The compiler adds the version parameter, so an input or a parameter declaring it is an error, located at the
// field that declares it. A derived body property (tree.schemas adds it) carries `derivedFrom`; a declared one
// does not.
fn check_not_restated(
    site: &TreeNodesSite<'_, '_>,
    source: &VersionSource,
    input: Option<&TypeUse>,
    params: &Params,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(restated) = restating_origin(site, source, input, params, scope) else {
        return Ok(());
    };
    let place = source.place.as_str();

    // A shared input schema restates the version for each of its operations at one pointer: reported once.
    let diagnostic = tree_nodes_error(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::ConcurrencyInput,
        origin: tree_nodes_node_origin(&restated)?,
        message: format!(
            "The operation {} declares {place}.{}, the version its concurrency adds.",
            site.operation_id, source.name
        ),
        fix: format!(
            "Remove {} from the operation; concurrency adds it.",
            source.name
        ),
        related: Vec::new(),
    });

    tree_nodes_report_once(
        &format!("concurrency-input:{}#{}", restated.layer, restated.pointer),
        diagnostic,
        scope,
    );

    Ok(())
}

fn restating_origin(
    site: &TreeNodesSite<'_, '_>,
    source: &VersionSource,
    input: Option<&TypeUse>,
    params: &Params,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Option<Origin> {
    match source.place {
        VersionPlace::Query => origin_of(
            site,
            params.query.iter().find(|param| param.name == source.name),
        ),
        VersionPlace::Header => {
            let name = source.name.to_lowercase();

            origin_of(
                site,
                params
                    .header
                    .iter()
                    .find(|param| param.name.to_lowercase() == name),
            )
        }
        VersionPlace::Body => {
            let first = source.name.split('.').next();
            let schema = tree_nodes_object_of(scope.draft, input)?;

            schema
                .properties
                .iter()
                .find(|property| {
                    Some(property.name.as_str()) == first && property.derived_from.is_none()
                })
                .map(|property| property.origin.clone())
        }
    }
}

fn report_nothing_to_inherit(
    site: &TreeNodesSite<'_, '_>,
    why: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let origin = scope
        .context
        .origin(&format!("{}/concurrency", site.node.pointer))
        .unwrap_or_else(|| site.node.origin.clone());

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::ConcurrencyInherit,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The route {} writes concurrency: inherit, but it {why}.",
                site.operation_id
            ),
            fix: "Remove concurrency: inherit, or declare concurrency on the collection that owns the route.".to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

#[cfg(test)]
mod tests {
    use seampact_json::JsonValue;

    use super::{VersionPlace, parse_source};

    #[test]
    fn a_source_name_is_one_or_more_characters_with_no_line_terminator() {
        let parsed = |text: &str| parse_source(Some(&JsonValue::String(text.to_owned())));

        let source = parsed("header.If-Match").expect("a header source");

        assert_eq!(source.place, VersionPlace::Header);
        assert_eq!(source.name, "If-Match");
        assert_eq!(parsed("body.a.b").expect("a body source").name, "a.b");

        for text in [
            "body.",
            "body",
            "cookie.v",
            "body.a\nb",
            "body.a\rb",
            "body.a\u{2028}b",
            "body.a\u{2029}b",
        ] {
            assert!(parsed(text).is_none(), "text {text:?}");
        }

        assert!(parse_source(Some(&JsonValue::Null)).is_none());
    }
}
