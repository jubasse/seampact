//! The one budget of a load.
//!
//! Every unit of work authored input drives is charged to it, wherever the work happens: each node
//! expanded (once per use of the file holding it), each `$include` target and `$file` site, each
//! node copied into an api's merged tree, each leaf origin and location written, each pack
//! visited for visibility. The characters of every string admitted into a tree, keys included, are
//! charged to its text limit, once per use and once per api the string reaches. A charge never
//! stops at a cache: a file parsed once and used a thousand times is charged a thousand times,
//! since each use builds its own nodes.

use seampact_diagnostics::InternalError;
use seampact_span::{SourceFiles, Span};

use crate::report::{
    LoadMessage, LoadRule, PendingDiagnostic, text_limit_message, work_limit_message,
};
use crate::{LOAD_MAX_TEXT, LOAD_MAX_WORK, Reporter};

/// The units of work and the characters of text one load has spent.
///
/// The first charge over a limit reports `seampact/load/expansion-limit` at the site that made it,
/// and every later charge fails, so the load winds down without further work.
#[derive(Debug, Default)]
pub struct LoadBudget {
    work: u64,
    text: u64,
    spent: bool,
}

impl LoadBudget {
    /// A budget with nothing spent.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a limit was passed.
    #[must_use]
    pub fn exhausted(&self) -> bool {
        self.spent
    }

    /// Charges `units` of work; `false` once the budget is spent. `at` is asked only when this
    /// charge passes the limit.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the site of the diagnostic is outside its file.
    pub fn charge(
        &mut self,
        units: u64,
        at: impl FnOnce() -> Span,
        reporter: &mut Reporter,
        files: &SourceFiles,
    ) -> Result<bool, InternalError> {
        if self.spent {
            return Ok(false);
        }

        self.work = self.work.saturating_add(units);

        if self.work <= LOAD_MAX_WORK {
            return Ok(true);
        }

        self.exhaust(work_limit_message(), at(), reporter, files)
    }

    /// Charges the characters (UTF-16 units) of an admitted string; `false` once the budget is
    /// spent. `at` is asked only when this charge passes the limit.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the site of the diagnostic is outside its file.
    pub fn charge_text(
        &mut self,
        chars: u64,
        at: impl FnOnce() -> Span,
        reporter: &mut Reporter,
        files: &SourceFiles,
    ) -> Result<bool, InternalError> {
        if self.spent {
            return Ok(false);
        }

        self.text = self.text.saturating_add(chars);

        if self.text <= LOAD_MAX_TEXT {
            return Ok(true);
        }

        self.exhaust(text_limit_message(), at(), reporter, files)
    }

    fn exhaust(
        &mut self,
        message: LoadMessage,
        at: Span,
        reporter: &mut Reporter,
        files: &SourceFiles,
    ) -> Result<bool, InternalError> {
        self.spent = true;
        reporter.report(
            files,
            PendingDiagnostic::new(LoadRule::ExpansionLimit, message.message, message.fix, at),
        )?;

        Ok(false)
    }
}

/// The length of `text` in UTF-16 code units, as `String.prototype.length` counts it.
#[must_use]
pub fn utf16_length(text: &str) -> u64 {
    text.encode_utf16().count() as u64
}

/// The work of writing a pointer (or any key built from authored text): one unit, plus one per 256
/// characters, so a node under a very long key costs what hashing its pointer costs.
#[must_use]
pub fn load_work_of(text: &str) -> u64 {
    1 + (utf16_length(text) >> 8)
}
