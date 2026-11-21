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
