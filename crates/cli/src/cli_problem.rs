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
