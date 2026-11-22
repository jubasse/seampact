//! The text of one problem the CLI prints on stderr.

use seampact_cli_config::CliProblem;
use seampact_ir::OperationId;
use seampact_target::Refusal;

use crate::CliError;
use crate::contract_position::{ContractPositions, contract_position};

/// The problem as one line,
/// `<contract file:line>: <code>: <where>: <message> Fix: <fix> Docs: <url>`, each absent part
/// left out with its separator.
#[must_use]
pub fn format_problem(problem: &CliProblem) -> String {
    let position = problem
        .position
        .as_ref()
        .map_or_else(String::new, |position| format!("{position}: "));
    let location = problem
        .location
        .as_ref()
        .map_or_else(String::new, |location| format!("{location}: "));
    let docs = problem
        .docs
        .as_ref()
        .map_or_else(String::new, |docs| format!(" Docs: {docs}"));

    format!(
        "{position}{}: {location}{} Fix: {}{docs}",
        problem.code, problem.message, problem.fix
    )
}

/// A problem with no position, no docs link and no location.
pub(crate) fn unlocated_problem(code: &str, message: String, fix: &str) -> CliProblem {
    CliProblem {
        code: code.to_owned(),
        message,
        fix: fix.to_owned(),
        location: None,
        position: None,
        docs: None,
    }
}

/// A problem that names where it belongs (`location`: a source, an entry, an api).
pub(crate) fn located_problem(
    code: &str,
    message: String,
    fix: &str,
    location: String,
) -> CliProblem {
    CliProblem {
        location: Some(location),
        ..unlocated_problem(code, message, fix)
    }
}

/// The location of a target entry, and of one of its apis when given.
pub(crate) fn entry_where(entry_id: &str, api: Option<&str>) -> String {
    match api {
        Some(api) => format!("entry '{entry_id}', api '{api}'"),
        None => format!("entry '{entry_id}'"),
    }
}

/// The location of a target entry under `app` when the run reads several apps.
pub(crate) fn app_entry_where(app: Option<&str>, entry_id: &str, api: Option<&str>) -> String {
    let location = entry_where(entry_id, api);

    match app {
        Some(app) => format!("app '{app}', {location}"),
        None => location,
    }
}

/// `problem` located inside `app`, in front of its own location.
pub(crate) fn in_app(app: &str, problem: CliProblem) -> CliProblem {
    let location = match &problem.location {
        Some(location) => format!("app '{app}', {location}"),
        None => format!("app '{app}'"),
    };

    CliProblem {
        location: Some(location),
        ..problem
    }
}

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
pub(crate) fn problem_from_refusal(
    refusal: &Refusal,
    location: String,
    positions: Option<&ContractPositions<'_>>,
) -> Result<CliProblem, CliError> {
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
        Some(positions) => contract_position(positions, member, operation)?,
        None => None,
    };

    Ok(CliProblem {
        code: refusal.code.clone(),
        message: format!("{}{at}", refusal.message),
        fix: refusal.fix.clone(),
        location: Some(location),
        position,
        docs: refusal.docs.clone(),
    })
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
            assert_eq!(names_pointer(message, pointer), named, "message {message:?}");
        }
    }

    #[test]
    fn a_problem_in_an_app_keeps_its_own_location_after_the_app() {
        let problem = unlocated_problem("x.y", "m".to_owned(), "f");
        let located = located_problem("x.y", "m".to_owned(), "f", "entry 'e'".to_owned());

        assert_eq!(
            in_app("web", problem).location.as_deref(),
            Some("app 'web'")
        );
        assert_eq!(
            in_app("web", located).location.as_deref(),
            Some("app 'web', entry 'e'")
        );
    }

    #[test]
    fn absent_parts_leave_out_their_separators() {
        let mut problem = CliProblem {
            code: "cli.usage".to_owned(),
            message: "No command given.".to_owned(),
            fix: "Run it.".to_owned(),
            location: None,
            position: None,
            docs: None,
        };

        assert_eq!(
            format_problem(&problem),
            "cli.usage: No command given. Fix: Run it."
        );

        problem.location = Some("seampact.config.yaml:3".to_owned());
        problem.position = Some("contract/api.yaml:7".to_owned());
        problem.docs = Some("https://example.test/#row".to_owned());

        assert_eq!(
            format_problem(&problem),
            "contract/api.yaml:7: cli.usage: seampact.config.yaml:3: No command given. Fix: Run it. Docs: https://example.test/#row"
        );
    }
}
