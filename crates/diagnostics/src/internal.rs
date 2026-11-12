use std::error::Error;
use std::fmt;
use std::panic::Location;

use seampact_span::SpanError;

use crate::diagnostic_inert;

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
/// prints it and exits with [`EXIT_INTERNAL`]; it never goes into a sink. [`Display`](fmt::Display)
/// escapes `what`, which can hold authored text.
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
            diagnostic_inert(&self.what),
            self.at.file(),
            self.at.line()
        )
    }
}

impl Error for InternalError {}

/// A [`SpanError`] is a bug once the loader enforces its limits, so `?` turns it into an
/// internal error located at the `?`.
impl From<SpanError> for InternalError {
    #[track_caller]
    fn from(error: SpanError) -> Self {
        Self::new(error.to_string())
    }
}

const _: () = {
    const fn assert_send_sync<T: Send + Sync>() {}

    assert_send_sync::<InternalError>();
};

#[cfg(test)]
mod tests {
    use seampact_span::SpanError;

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
    fn an_internal_error_prints_authored_text_inert() {
        let error = InternalError::new("the span of 'api#/\u{1b}[2J\u{202E}' is outside");

        let printed = error.to_string();

        assert!(!printed.contains('\u{1b}'), "{printed:?}");
        assert!(!printed.contains('\u{202E}'), "{printed:?}");
        assert!(printed.contains("\\u001B[2J\\u202E"), "{printed:?}");
        assert_eq!(
            error.what(),
            "the span of 'api#/\u{1b}[2J\u{202E}' is outside"
        );
    }

    fn fail_with_a_span_error() -> (u32, Result<(), InternalError>) {
        let outside = SpanError::SpanOutsideFile {
            key: "api#/a".to_owned(),
        };

        let question_mark_line = line!() + 2;

        let report = || Err(outside)?;

        (question_mark_line, report())
    }

    #[test]
    fn a_span_error_becomes_an_internal_error_reported_at_the_question_mark() {
        let (question_mark_line, result) = fail_with_a_span_error();

        let error = result.expect_err("the table has no such span");

        assert_eq!(
            error.what(),
            "the span of location 'api#/a' is outside its file"
        );
        assert_eq!(error.at().file(), file!());
        assert_eq!(error.at().line(), question_mark_line);
    }

    #[test]
    fn the_exit_codes_are_distinct() {
        let codes = [EXIT_SUCCESS, EXIT_REFUSED, EXIT_USAGE, EXIT_INTERNAL];

        assert_eq!(codes, [0, 1, 2, 3]);
    }
}
