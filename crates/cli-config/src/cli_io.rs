//! What a command reads and writes besides files, and the printing of its problems and warnings.

use camino::Utf8Path;

use crate::{CliProblem, format_problem};

/// What a command reads and writes besides files; the binary passes the process, the
/// oracle a recording one.
pub trait CliIo {
    /// The directory relative paths of the command line resolve against.
    fn cwd(&self) -> &Utf8Path;

    /// Writes `text` to the standard output.
    fn stdout(&mut self, text: &str);

    /// Writes `text` to the standard error.
    fn stderr(&mut self, text: &str);

    /// The value of the environment variable `name`, when set.
    fn environment_variable(&self, name: &str) -> Option<String>;

    /// Today as `YYYY-MM-DD`, the diff's only time input.
    fn today(&self) -> String;
}

/// Prints each problem on its own stderr line.
pub fn print_problems(io: &mut dyn CliIo, problems: &[CliProblem]) {
    for problem in problems {
        io.stderr(&format!("{}\n", format_problem(problem)));
    }
}

/// Prints each warning on its own stderr line: what the generated files leave to the developer's
/// code, the command going on.
pub fn print_warnings(io: &mut dyn CliIo, warnings: &[CliProblem]) {
    for warning in warnings {
        io.stderr(&format!("warning: {}\n", format_problem(warning)));
    }
}
