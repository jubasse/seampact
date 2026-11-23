//! The one way the writer builds a refusal: a code, a message and a fix, nothing else.

use seampact_target::Refusal;

/// A refusal with no operation, member or docs link.
pub(crate) fn writer_refusal(
    code: &str,
    message: impl Into<String>,
    fix: impl Into<String>,
) -> Refusal {
    Refusal {
        code: code.to_owned(),
        message: message.into(),
        fix: fix.into(),
        operation: None,
        member: None,
        docs: None,
    }
}
