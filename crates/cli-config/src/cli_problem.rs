//! One refusal or diagnostic the CLI prints on stderr.

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
