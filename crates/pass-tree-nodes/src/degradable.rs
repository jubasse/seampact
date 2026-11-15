//! The `degradable` member: the body paths an operation may leave out, checked against its success data.

use seampact_diagnostics::InternalError;
use seampact_ir::{Degradable, Response, TypeUse, UnionSchema};
use seampact_json::JsonValue;
use seampact_pipeline::{ConventionReading, PassError};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
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

    if !format_fills_degraded(site, format, scope)? && header.is_none() {
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

fn format_fills_degraded(
    _site: &TreeNodesSite<'_, '_>,
    _format: &str,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("formatFillsDegraded"))
}

fn check_path(
    _site: &TreeNodesSite<'_, '_>,
    _path: &str,
    _pointer: &str,
    _body: Option<&TypeUse>,
    _header_written: bool,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkPath"))
}

// A degraded header name may not hold a character outside printable ASCII, a comma, or a space at either end.
fn name_unfit_for_header(name: &str) -> bool {
    name.chars()
        .any(|character| !(' '..='~').contains(&character) || character == ',')
        || name.starts_with(' ')
        || name.ends_with(' ')
}

fn path_fault(
    _site: &TreeNodesSite<'_, '_>,
    _segments: &[String],
    _type_use: &TypeUse,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("pathFault"))
}

fn variants_fault(
    _site: &TreeNodesSite<'_, '_>,
    _segments: &[String],
    _union: &UnionSchema,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("variantsFault"))
}

fn report_path(
    _site: &TreeNodesSite<'_, '_>,
    _pointer: &str,
    _message: &str,
    _fix: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportPath"))
}
