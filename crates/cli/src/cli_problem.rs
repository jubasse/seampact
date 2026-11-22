//! The text of one problem the CLI prints on stderr.

use seampact_cli_config::CliProblem;

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

#[cfg(test)]
mod tests {
    use super::*;

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
