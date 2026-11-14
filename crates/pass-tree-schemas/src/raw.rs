//! What the `tree.schemas` modules share: the raw values they read, JSON Pointers, origins and the
//! diagnostics they report (rules `seampact/tree/<rule>`).

use seampact_diagnostics::{Diagnostic, DiagnosticOrigin};
use seampact_ir::Origin;
use seampact_json::JsonValue;
use seampact_pipeline::{HalfContext, PassError};

use crate::not_ported::not_ported_yet;

/// A located problem of the half's run, its other locations by pointer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeSchemasProblem {
    pub(crate) rule: &'static str,
    pub(crate) pointer: String,
    pub(crate) message: String,
    pub(crate) fix: String,
    pub(crate) related: Option<Vec<TreeSchemasRelated>>,
}

/// Another location a problem points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeSchemasRelated {
    pub(crate) pointer: String,
    pub(crate) message: String,
}

/// Whether a raw value is a mapping.
pub(crate) fn tree_schemas_is_object(value: Option<&JsonValue>) -> Result<bool, PassError> {
    Err(not_ported_yet("treeSchemasIsObject"))
}

/// The own member `key` of a raw mapping; `None` when absent or when `value` is no mapping.
pub(crate) fn tree_schemas_member<'raw>(
    value: Option<&'raw JsonValue>,
    key: &str,
) -> Result<Option<&'raw JsonValue>, PassError> {
    Err(not_ported_yet("treeSchemasMember"))
}

/// The own entries of a raw mapping, in written order; none when `value` is no mapping.
pub(crate) fn tree_schemas_entries(
    value: Option<&JsonValue>,
) -> Result<Vec<(&str, &JsonValue)>, PassError> {
    Err(not_ported_yet("treeSchemasEntries"))
}

fn escape_segment(segment: &str) -> Result<String, PassError> {
    Err(not_ported_yet("escapeSegment"))
}

/// The pointer below `base` through `segments` (RFC 6901).
pub(crate) fn tree_schemas_pointer(base: &str, segments: &[&str]) -> Result<String, PassError> {
    Err(not_ported_yet("treeSchemasPointer"))
}

/// Origins and diagnostics at pointers of the merged raw tree.
///
/// It reads origins through a shared borrow of the context, so the relay copies can read the
/// relayed drafts beside it; the diagnostics it reports wait in the reporter and the entry moves
/// them into the context's sink once the compilation ends.
pub(crate) struct TreeSchemasReporter<'half, 'run> {
    context: &'half HalfContext<'run>,
    reported: Vec<Diagnostic>,
}

impl<'half, 'run> TreeSchemasReporter<'half, 'run> {
    pub(crate) fn new(context: &'half HalfContext<'run>) -> Result<Self, PassError> {
        Err(not_ported_yet("TreeSchemasReporter.constructor"))
    }

    /// The diagnostics reported so far, in report order.
    pub(crate) fn into_reported(self) -> Vec<Diagnostic> {
        self.reported
    }

    /// The origin of a node the half read; a pointer naming nothing is a bug of the half.
    pub(crate) fn origin(&self, pointer: &str) -> Result<Origin, PassError> {
        Err(not_ported_yet("TreeSchemasReporter.origin"))
    }

    /// Whether the merged raw tree holds a node at `pointer`.
    pub(crate) fn resolves(&self, pointer: &str) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasReporter.resolves"))
    }

    /// Reports an error at the problem's pointer.
    pub(crate) fn error(&mut self, problem: TreeSchemasProblem) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasReporter.error"))
    }

    fn located(&self, pointer: &str) -> Result<DiagnosticOrigin, PassError> {
        Err(not_ported_yet("TreeSchemasReporter.located"))
    }
}
