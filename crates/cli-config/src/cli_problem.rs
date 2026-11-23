//! One refusal or diagnostic the CLI prints on stderr, and its printed text.

use seampact_diagnostics::diagnostic_inert;

/// One refusal or diagnostic the CLI prints on stderr, as
/// `<contract file:line>: <code>: <where>: <message> Fix: <fix> Docs: <url>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CliProblem {
    /// The `code` member.
    pub code: String,
    /// The `message` member.
    pub message: String,
    /// The `fix` member.
    pub fix: String,
    /// The config file position and key path, or the target entry and api the problem belongs to.
    pub location: Option<String>,
    /// The contract `file:line` the refused member is declared at.
    pub position: Option<String>,
    /// The URL of the troubleshooting section that holds the code's row.
    pub docs: Option<String>,
}

impl CliProblem {
    /// A problem of a config file: `location` is the file, position and key path.
    pub(crate) fn at(code: &str, message: String, fix: &str, location: String) -> Self {
        Self {
            code: code.to_owned(),
            message,
            fix: fix.to_owned(),
            location: Some(location),
            position: None,
            docs: None,
        }
    }

    /// A problem with no location.
    pub(crate) fn unlocated(code: &str, message: String, fix: &str) -> Self {
        Self {
            code: code.to_owned(),
            message,
            fix: fix.to_owned(),
            location: None,
            position: None,
            docs: None,
        }
    }
}

/// Past this many characters a field of a printed problem is cut: the text can come from a hostile tree.
pub const PROBLEM_FIELD_LIMIT: usize = 1000;

/// What a cut field ends with, as the quoted values of a message do.
const PROBLEM_CUT_MARK: char = '\u{2026}';

/// The problem as one line,
/// `<contract file:line>: <code>: <where>: <message> Fix: <fix> Docs: <url>`, each absent part
/// left out with its separator.
///
/// Every field is cut past [`PROBLEM_FIELD_LIMIT`] characters and written inert, so authored text
/// never reaches the terminal as an escape sequence.
#[must_use]
pub fn format_problem(problem: &CliProblem) -> String {
    let position = problem
        .position
        .as_deref()
        .map_or_else(String::new, |position| {
            format!("{}: ", printable_field(position))
        });
    let location = problem
        .location
        .as_deref()
        .map_or_else(String::new, |location| {
            format!("{}: ", printable_field(location))
        });
    let docs = problem.docs.as_deref().map_or_else(String::new, |docs| {
        format!(" Docs: {}", printable_field(docs))
    });

    format!(
        "{position}{}: {location}{} Fix: {}{docs}",
        printable_field(&problem.code),
        printable_field(&problem.message),
        printable_field(&problem.fix)
    )
}

/// `text` cut past [`PROBLEM_FIELD_LIMIT`] characters, then written inert.
fn printable_field(text: &str) -> String {
    let mut kept: String = text.chars().take(PROBLEM_FIELD_LIMIT).collect();

    if text.chars().nth(PROBLEM_FIELD_LIMIT).is_some() {
        kept.push(PROBLEM_CUT_MARK);
    }

    diagnostic_inert(&kept)
}

/// A problem with no position, no docs link and no location.
#[must_use]
pub fn unlocated_problem(code: &str, message: String, fix: &str) -> CliProblem {
    CliProblem::unlocated(code, message, fix)
}

/// A problem that names where it belongs (`location`: a source, an entry, an api).
#[must_use]
pub fn located_problem(code: &str, message: String, fix: &str, location: String) -> CliProblem {
    CliProblem::at(code, message, fix, location)
}

/// The location of a target entry, and of one of its apis when given.
#[must_use]
pub fn entry_where(entry_id: &str, api: Option<&str>) -> String {
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

    fn is_active(character: char) -> bool {
        character.is_control()
            || matches!(character, '\u{200B}'..='\u{200F}' | '\u{2028}'..='\u{202E}')
    }

    #[test]
    fn a_problem_is_printed_without_a_character_a_terminal_acts_on() {
        let problem = CliProblem {
            code: "x.\u{1b}y".to_owned(),
            message: "a\u{1b}[2J\u{202e}b".to_owned(),
            fix: "f\u{7}".to_owned(),
            location: Some("source '\u{9b}'".to_owned()),
            position: Some("api\u{1b}.yaml:1".to_owned()),
            docs: Some("https://x.test/\u{200b}".to_owned()),
        };
        let printed = format_problem(&problem);

        assert!(!printed.chars().any(is_active), "{printed:?}");
        assert!(printed.contains("a\\u001B[2J\\u202Eb"), "{printed}");
    }

    #[test]
    fn a_field_past_the_bound_is_cut_with_an_ellipsis() {
        let problem = unlocated_problem("x.y", "m".repeat(PROBLEM_FIELD_LIMIT + 50), "f");
        let printed = format_problem(&problem);

        assert!(
            printed.chars().count() < PROBLEM_FIELD_LIMIT + 50,
            "{}",
            printed.len()
        );
        assert!(printed.contains("\u{2026} Fix: f"), "{printed}");
    }
}
