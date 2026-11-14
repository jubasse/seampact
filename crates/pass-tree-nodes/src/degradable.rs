//! The `degradable` member: the body paths an operation may leave out, checked against its success data.

use seampact_ir::{Degradable, Response, TypeUse, UnionSchema};
use seampact_pipeline::PassError;

use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The name a degraded header may not take: a character outside printable ASCII, a comma, or a space at either end.
const HEADER_UNSAFE_NAME: &str = r"[^\x20-\x7e]|,|^ | $";
/// The meta fill that names the degraded paths.
const DEGRADED_FILL: &str = "degraded";
const NO_PROPERTY: &str = "names no property of the success data";

pub(crate) fn tree_nodes_degradable(
    _site: &TreeNodesSite<'_, '_>,
    _format: &str,
    _responses: &[Response],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Degradable>, PassError> {
    Err(not_ported_yet("treeNodesDegradable"))
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

fn name_unfit_for_header(_name: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("nameUnfitForHeader"))
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
