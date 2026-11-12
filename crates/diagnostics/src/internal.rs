use std::error::Error;
use std::fmt;
use std::panic::Location;

/// The exit code of a run that compiled.
pub const EXIT_SUCCESS: i32 = 0;
/// The exit code of a run that refused the contract with diagnostics.
pub const EXIT_REFUSED: i32 = 1;
/// The exit code of a command line the CLI cannot run.
pub const EXIT_USAGE: i32 = 2;
/// The exit code of a run stopped by an [`InternalError`]; the native channels read it as
/// `binary.compile-failed`.
pub const EXIT_INTERNAL: i32 = 3;

/// A bug: a state the code itself should have made impossible (a span outside its file, a
/// table entry the code wrote and cannot find). It goes up with `?` to the driver, which
/// prints it and exits with [`EXIT_INTERNAL`]; it never goes into a sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InternalError {
    what: String,
    at: &'static Location<'static>,
}

impl InternalError {
    /// The bug `what`, located at the source line that calls this.
    #[must_use]
    #[track_caller]
    pub fn new(what: impl Into<String>) -> Self {
        Self {
            what: what.into(),
            at: Location::caller(),
        }
    }

    /// What broke.
    #[must_use]
    pub fn what(&self) -> &str {
        &self.what
    }

    /// The Rust source position that reported it.
    #[must_use]
    pub fn at(&self) -> &'static Location<'static> {
        self.at
    }
}

impl fmt::Display for InternalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "internal error: {} at {}:{}. Fix: report it with the seampact version.",
            self.what,
            self.at.file(),
            self.at.line()
        )
    }
}

impl Error for InternalError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_internal_error_names_what_broke_and_where() {
        let line = line!() + 1;
        let error = InternalError::new("the span of 'api#/a' is outside its file");

        assert_eq!(error.what(), "the span of 'api#/a' is outside its file");
        assert_eq!(error.at().line(), line);
        assert_eq!(
            error.to_string(),
            format!(
                "internal error: the span of 'api#/a' is outside its file at {}:{line}. Fix: report it with the seampact version.",
                file!()
            )
        );
    }

    #[test]
    fn the_exit_codes_are_distinct() {
        let codes = [EXIT_SUCCESS, EXIT_REFUSED, EXIT_USAGE, EXIT_INTERNAL];

        assert_eq!(codes, [0, 1, 2, 3]);
    }
}
