//! What the `tree.schemas` modules share: the raw values they read, JSON Pointers, origins and the
//! diagnostics they report (rules `seampact/tree/<rule>`).

use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, Severity,
};
use seampact_ir::Origin;
use seampact_json::{JsonValue, escape_pointer};
use seampact_pipeline::{HalfContext, PassError};

use crate::rule::TreeSchemasRule;

/// A located problem of the half's run, its other locations by pointer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TreeSchemasProblem {
    pub(crate) rule: TreeSchemasRule,
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
pub(crate) const fn tree_schemas_is_object(value: Option<&JsonValue>) -> bool {
    matches!(value, Some(JsonValue::Object(_)))
}

/// The own member `key` of a raw mapping; `None` when absent or when `value` is no mapping.
pub(crate) fn tree_schemas_member<'raw>(
    value: Option<&'raw JsonValue>,
    key: &str,
) -> Option<&'raw JsonValue> {
    match value {
        Some(JsonValue::Object(object)) => object.get(key),
        _ => None,
    }
}

/// The own entries of a raw mapping, in written order; none when `value` is no mapping.
pub(crate) fn tree_schemas_entries(value: Option<&JsonValue>) -> Vec<(&str, &JsonValue)> {
    match value {
        Some(JsonValue::Object(object)) => object
            .iter()
            .map(|(key, member)| (key.as_str(), member))
            .collect(),
        _ => Vec::new(),
    }
}

/// The property of a written source `<prefix><property>`: the text after the prefix when it is not
/// empty and holds no line terminator, as the TypeScript `^<prefix>(.+)$` reads it.
pub(crate) fn tree_schemas_source_property<'text>(
    text: &'text str,
    prefix: &str,
) -> Option<&'text str> {
    let property = text.strip_prefix(prefix)?;
    let has_line_terminator = property
        .chars()
        .any(|character| matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}'));

    if property.is_empty() || has_line_terminator {
        return None;
    }

    Some(property)
}

fn escape_segment(segment: &str) -> String {
    format!("/{}", escape_pointer(segment))
}

/// The pointer below `base` through `segments` (RFC 6901).
pub(crate) fn tree_schemas_pointer(base: &str, segments: &[&str]) -> String {
    let escaped: String = segments
        .iter()
        .map(|segment| escape_segment(segment))
        .collect();

    format!("{base}{escaped}")
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
    pub(crate) const fn new(context: &'half HalfContext<'run>) -> Self {
        Self {
            context,
            reported: Vec::new(),
        }
    }

    /// The diagnostics reported so far, in report order.
    pub(crate) fn into_reported(self) -> Vec<Diagnostic> {
        self.reported
    }

    /// The origin of a node the half read; a pointer naming nothing is a bug of the half.
    pub(crate) fn origin(&self, pointer: &str) -> Result<Origin, PassError> {
        self.context.origin(pointer).ok_or_else(|| {
            PassError::from(InternalError::new(format!(
                "tree.schemas read no node at {pointer}"
            )))
        })
    }

    /// Whether the merged raw tree holds a node at `pointer`.
    pub(crate) fn resolves(&self, pointer: &str) -> bool {
        self.context.origin(pointer).is_some()
    }

    /// Reports an error at the problem's pointer.
    pub(crate) fn error(&mut self, problem: TreeSchemasProblem) -> Result<(), PassError> {
        let origin = self.located(&problem.pointer)?;
        let related = problem
            .related
            .iter()
            .flatten()
            .map(|other| {
                Ok(RelatedLocation {
                    origin: self.located(&other.pointer)?,
                    message: other.message.clone(),
                })
            })
            .collect::<Result<Vec<_>, PassError>>()?;

        self.reported.push(Diagnostic {
            severity: Severity::Error,
            rule: problem.rule.rule_id(),
            message: problem.message,
            fix: problem.fix,
            origin,
            related,
        });

        Ok(())
    }

    fn located(&self, pointer: &str) -> Result<DiagnosticOrigin, PassError> {
        let origin = self.origin(pointer)?;

        DiagnosticOrigin::of(&origin).ok_or_else(|| {
            PassError::from(InternalError::new(format!(
                "tree.schemas located a diagnostic at core {pointer}"
            )))
        })
    }
}
