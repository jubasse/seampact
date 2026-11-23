//! The problem a target's refusal prints, with the operation, IR member and contract position it names.

use seampact_cli_config::CliProblem;
use seampact_ir::OperationId;
use seampact_target::Refusal;

use crate::contract_position::{ContractPositions, contract_position};

/// Whether `message` writes `pointer` as a whole: not followed by `/` or a word character.
fn names_pointer(message: &str, pointer: &str) -> bool {
    // Every start position is tried, as a regular expression search does, so occurrences may overlap.
    message.char_indices().any(|(start, _)| {
        let Some(rest) = message.get(start..) else {
            return false;
        };
        let Some(after) = rest.strip_prefix(pointer) else {
            return false;
        };

        !after
            .chars()
            .next()
            .is_some_and(|next| next == '/' || next == '_' || next.is_ascii_alphanumeric())
    })
}

/// The problem a target's refusal prints: its message followed by the operation and IR member it
/// names when the message does not, and the contract position when `positions` locates it.
#[must_use]
pub fn problem_from_refusal(
    refusal: &Refusal,
    location: String,
    positions: Option<&ContractPositions<'_>>,
) -> CliProblem {
    let operation = refusal.operation.as_ref().map(OperationId::as_str);
    let member = refusal.member.as_deref();
    let mut pointers: Vec<String> = Vec::new();

    if let Some(operation) = operation
        && !refusal.message.contains(&format!("'{operation}'"))
    {
        pointers.push(format!("operation '{operation}'"));
    }

    if let Some(member) = member
        && !member.is_empty()
        && !names_pointer(&refusal.message, member)
    {
        pointers.push(format!("IR member '{member}'"));
    }

    let at = if pointers.is_empty() {
        String::new()
    } else {
        format!(" ({})", pointers.join(", "))
    };
    let position = match positions {
        Some(positions) => contract_position(positions, member, operation),
        None => None,
    };

    CliProblem {
        code: refusal.code.clone(),
        message: format!("{}{at}", refusal.message),
        fix: refusal.fix.clone(),
        location: Some(location),
        position,
        docs: refusal.docs.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pointer_counts_as_named_only_when_the_message_ends_it() {
        let cases = [
            ("bad /a/b here", "/a/b", true),
            ("bad /a/bc here", "/a/b", false),
            ("bad /a/b/c here", "/a/b", false),
            ("bad /a/b_ here", "/a/b", false),
            ("/a/bc then /a/b.", "/a/b", true),
            ("bad /a/b", "/a/b", true),
            ("aab", "aa", false),
            ("aaa", "aa", true),
            ("nothing", "/a/b", false),
        ];

        for (message, pointer, named) in cases {
            assert_eq!(
                names_pointer(message, pointer),
                named,
                "message {message:?}"
            );
        }
    }
}
