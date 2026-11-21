//! Why a target produces no file, with the fix.

use std::collections::HashSet;

use seampact_ir::OperationId;

/// Why a target produces no file, with the fix.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Refusal {
    /// The refusal code, such as `ir.value.unknown`.
    pub code: String,
    /// What is refused.
    pub message: String,
    /// What to change.
    pub fix: String,
    /// The operation the refused form belongs to, if any.
    pub operation: Option<OperationId>,
    /// A JSON Pointer into the IR, or into the target options for their parsing.
    pub member: Option<String>,
    /// The URL of the troubleshooting section that holds the code's row.
    pub docs: Option<String>,
}

/// The refusals with each repeat of a code, member and operation left out, the first kept: a form
/// shared by several operations, such as an error code's params, is refused once.
#[must_use]
pub fn without_repeats(refusals: Vec<Refusal>) -> Vec<Refusal> {
    let first_of_its_key: Vec<bool> = {
        let mut seen = HashSet::new();

        refusals
            .iter()
            .map(|refusal| {
                seen.insert((
                    refusal.code.as_str(),
                    refusal.member.as_deref(),
                    refusal.operation.as_ref().map(OperationId::as_str),
                ))
            })
            .collect()
    };

    refusals
        .into_iter()
        .zip(first_of_its_key)
        .filter_map(|(refusal, first)| first.then_some(refusal))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn refusal(
        code: &str,
        member: Option<&str>,
        operation: Option<&str>,
        message: &str,
    ) -> Refusal {
        Refusal {
            code: code.to_owned(),
            message: message.to_owned(),
            fix: String::new(),
            operation: operation.map(|id| OperationId::new(id.to_owned())),
            member: member.map(str::to_owned),
            docs: None,
        }
    }

    #[test]
    fn a_repeat_of_code_member_and_operation_is_left_out_and_the_first_kept() {
        let refusals = vec![
            refusal("a", Some("/x"), None, "first"),
            refusal("a", Some("/x"), None, "second"),
            refusal("a", Some("/x"), Some("op"), "other operation"),
            refusal("a", None, None, "no member"),
            refusal("b", Some("/x"), None, "other code"),
        ];

        let messages: Vec<String> = without_repeats(refusals)
            .into_iter()
            .map(|kept| kept.message)
            .collect();

        assert_eq!(
            messages,
            ["first", "other operation", "no member", "other code"]
        );
    }
}
