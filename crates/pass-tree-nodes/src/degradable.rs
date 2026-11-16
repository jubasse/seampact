//! The `degradable` member: the body paths an operation may leave out, checked against its success data.

use seampact_diagnostics::InternalError;
use seampact_ir::{Degradable, Response, Schema, TypeUse, UnionSchema};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{tree_nodes_draft_schema, tree_nodes_member};
use seampact_pipeline::{ConventionReading, PassError};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::pass::TreeNodesScope;

/// The meta fill that names the degraded paths.
const DEGRADED_FILL: &str = "degraded";
/// The statuses below this one are successes.
const SUCCESS_BELOW: i64 = 300;
const NO_PROPERTY: &str = "names no property of the success data";

/// The degradable paths of an operation, checked against its success body.
pub(crate) fn tree_nodes_degradable(
    site: &TreeNodesSite<'_, '_>,
    format: &str,
    responses: &[Response],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Degradable>, PassError> {
    let pointer = format!("{}/degradable", site.node.pointer);
    let Some(JsonValue::Array(written)) = site.node.settings.get("degradable") else {
        return Ok(None);
    };
    let Some(origin) = scope.context.origin(&pointer) else {
        return Err(InternalError::new(format!("the raw tree has no origin for {pointer}")).into());
    };
    let header = match scope.context.conventions.get("degradedHeader")? {
        Some(ConventionReading {
            value: JsonValue::String(header),
            ..
        }) => Some(header.clone()),
        _ => None,
    };
    let mut paths: Vec<String> = Vec::with_capacity(written.len());

    for (index, path) in written.iter().enumerate() {
        let JsonValue::String(path) = path else {
            return Err(InternalError::new(format!(
                "{pointer}/{index} is not a string, which validate guarantees"
            ))
            .into());
        };

        paths.push(path.clone());
    }

    let success_body = responses
        .iter()
        .find(|response| response.status < SUCCESS_BELOW && response.body.is_some())
        .and_then(|response| response.body.as_ref());

    for (index, path) in paths.iter().enumerate() {
        let path_pointer = format!("{pointer}/{index}");

        check_path(
            site,
            path,
            &path_pointer,
            success_body,
            header.is_some(),
            scope,
        )?;
    }

    if !format_fills_degraded(format, scope) && header.is_none() {
        scope.context.report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::DegradableHeader,
            origin: tree_nodes_node_origin(&origin)?,
            message: format!(
                "The route {} is degradable, but its format {format} has no degraded meta field and conventions.degradedHeader is unset.",
                site.operation_id
            ),
            fix: "Set conventions.degradedHeader, or use a format with a meta field filled with degraded."
                .to_owned(),
            related: Vec::new(),
        }));
    }

    Ok(Some(Degradable {
        paths,
        header,
        origin,
    }))
}

fn format_fills_degraded(format: &str, scope: &TreeNodesScope<'_, '_, '_>) -> bool {
    let formats = scope.context.raw.merged.get("formats");
    let meta = tree_nodes_member(tree_nodes_member(formats, format), "meta");

    let Some(JsonValue::Object(meta)) = meta else {
        return false;
    };

    meta.values().any(|field| {
        tree_nodes_member(Some(field), "fill") == Some(&JsonValue::String(DEGRADED_FILL.to_owned()))
    })
}

// The success data a path reaches into; a route with no success body has none to leave out. Where the header is
// written, its value lists the path as written, so a name it cannot carry is refused.
fn check_path(
    site: &TreeNodesSite<'_, '_>,
    path: &str,
    pointer: &str,
    body: Option<&TypeUse>,
    header_written: bool,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let segments: Vec<String> = path.split('.').map(str::to_owned).collect();
    let fault = match body {
        None => Some(NO_PROPERTY.to_owned()),
        Some(body) => path_fault(&segments, body, scope)?,
    };

    if let Some(fault) = fault {
        return report_path(
            site,
            pointer,
            &format!(
                "The degradable path {path} of {} {fault}; only an optional part can be left out.",
                site.operation_id
            ),
            "Name an optional object property of the success data, or make the property optional.",
            scope,
        );
    }

    if header_written
        && segments
            .iter()
            .any(|segment| name_unfit_for_header(segment))
    {
        return report_path(
            site,
            pointer,
            &format!(
                "The degradable path {path} of {} names a property the degraded header cannot carry: a name may hold no comma, no character outside visible ASCII and space, and no leading or trailing space.",
                site.operation_id
            ),
            "Rename the property, or leave it out of degradable.",
            scope,
        );
    }

    Ok(())
}

// A degraded header name may not hold a character outside printable ASCII, a comma, or a space at either end.
fn name_unfit_for_header(name: &str) -> bool {
    name.chars()
        .any(|character| !(' '..='~').contains(&character) || character == ',')
        || name.starts_with(' ')
        || name.ends_with(' ')
}

// Each segment names a property of the object reached so far, in every variant of a union; the last one must be
// optional. `None` when the path fits.
fn path_fault(
    segments: &[String],
    type_use: &TypeUse,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<String>, PassError> {
    let reached = match type_use {
        TypeUse::Array(array) => &*array.items,
        other => other,
    };
    let TypeUse::Ref(reference) = reached else {
        return Ok(Some(NO_PROPERTY.to_owned()));
    };

    schema_fault(segments, reference.schema.as_str(), scope)
}

fn schema_fault(
    segments: &[String],
    schema_id: &str,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<String>, PassError> {
    let schema = tree_nodes_draft_schema(scope.draft, schema_id)?;

    let Schema::Object(object) = schema else {
        return match schema {
            Schema::Union(union) => variants_fault(segments, union, scope),
            _ => Ok(Some(NO_PROPERTY.to_owned())),
        };
    };
    let Some((segment, rest)) = segments.split_first() else {
        return Ok(Some(NO_PROPERTY.to_owned()));
    };
    let Some(property) = object
        .properties
        .iter()
        .find(|candidate| candidate.name == *segment)
    else {
        return Ok(Some(NO_PROPERTY.to_owned()));
    };

    if !rest.is_empty() {
        return path_fault(rest, &property.r#type, scope);
    }

    Ok((!property.optional).then(|| "names a required property".to_owned()))
}

fn variants_fault(
    segments: &[String],
    union: &UnionSchema,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<String>, PassError> {
    for variant in &union.variants {
        let fault = schema_fault(segments, variant.schema.as_str(), scope)?;

        if let Some(fault) = fault {
            return Ok(Some(format!(
                "{fault} in the variant {} of {}",
                variant.tag,
                union.id.as_str()
            )));
        }
    }

    Ok(None)
}

fn report_path(
    site: &TreeNodesSite<'_, '_>,
    pointer: &str,
    message: &str,
    fix: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let origin = scope
        .context
        .origin(pointer)
        .unwrap_or_else(|| site.node.origin.clone());

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::DegradablePath,
            origin: tree_nodes_node_origin(&origin)?,
            message: message.to_owned(),
            fix: fix.to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::name_unfit_for_header;

    #[test]
    fn a_header_name_holds_printable_ascii_without_comma_or_edge_space() {
        let fit = ["x-request-id", "a b", "~", "!"];
        let unfit = ["a,b", " a", "a ", "é", "a\tb", "\u{7f}", "a\u{1F600}"];

        for name in fit {
            assert!(!name_unfit_for_header(name), "name {name:?}");
        }

        for name in unfit {
            assert!(name_unfit_for_header(name), "name {name:?}");
        }
    }
}
