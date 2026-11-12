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

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use seampact_span::TextSize;

    use super::*;

    fn site_in_one_file() -> (SourceFiles, Span) {
        let mut files = SourceFiles::new();
        let file = files
            .add("api.yaml", "a: 1\nb: 2\n")
            .expect("the file is added");
        let span = Span::new(file, TextSize::from(5), TextSize::from(6));

        (files, span)
    }

    #[test]
    fn work_up_to_the_limit_is_admitted_and_one_unit_more_is_refused() -> Result<(), InternalError>
    {
        let (files, span) = site_in_one_file();
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();

        assert!(budget.charge(LOAD_MAX_WORK - 1, || span, &mut reporter, &files)?);
        assert!(budget.charge(1, || span, &mut reporter, &files)?);
        assert!(!budget.exhausted());
        assert!(reporter.is_empty());

        assert!(!budget.charge(1, || span, &mut reporter, &files)?);
        assert!(budget.exhausted());

        let [diagnostic] = reporter.diagnostics() else {
            panic!("one diagnostic expected, got {}", reporter.len());
        };

        assert_eq!(diagnostic.rule.as_str(), "seampact/load/expansion-limit");
        assert_eq!(diagnostic.message, work_limit_message().message);
        assert_eq!(diagnostic.fix, work_limit_message().fix);
        assert!(diagnostic.message.contains("more than 2000000 units"));

        Ok(())
    }

    #[test]
    fn text_up_to_the_limit_is_admitted_and_one_character_more_is_refused()
    -> Result<(), InternalError> {
        let (files, span) = site_in_one_file();
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();

        assert!(budget.charge_text(LOAD_MAX_TEXT, || span, &mut reporter, &files)?);
        assert!(!budget.charge_text(1, || span, &mut reporter, &files)?);

        let [diagnostic] = reporter.diagnostics() else {
            panic!("one diagnostic expected, got {}", reporter.len());
        };

        assert_eq!(diagnostic.message, text_limit_message().message);
        assert!(diagnostic.message.contains("more than 67108864 characters"));

        Ok(())
    }

    #[test]
    fn once_spent_every_charge_fails_and_nothing_more_is_reported() -> Result<(), InternalError> {
        let (files, span) = site_in_one_file();
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();

        assert!(!budget.charge(LOAD_MAX_WORK + 1, || span, &mut reporter, &files)?);
        assert!(!budget.charge(1, || span, &mut reporter, &files)?);
        assert!(!budget.charge_text(1, || span, &mut reporter, &files)?);
        assert!(!budget.charge_text(LOAD_MAX_TEXT + 1, || span, &mut reporter, &files)?);
        assert_eq!(reporter.len(), 1);

        Ok(())
    }

    #[test]
    fn work_and_text_are_counted_apart() -> Result<(), InternalError> {
        let (files, span) = site_in_one_file();
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();

        assert!(budget.charge(LOAD_MAX_WORK, || span, &mut reporter, &files)?);
        assert!(budget.charge_text(LOAD_MAX_TEXT, || span, &mut reporter, &files)?);
        assert!(reporter.is_empty());

        Ok(())
    }

    #[test]
    fn the_site_is_asked_for_only_by_the_charge_that_passes_the_limit() -> Result<(), InternalError>
    {
        let (files, span) = site_in_one_file();
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();
        let asked = Cell::new(0);
        let at = || {
            asked.set(asked.get() + 1);

            span
        };

        assert!(budget.charge(1, at, &mut reporter, &files)?);
        assert!(budget.charge_text(1, at, &mut reporter, &files)?);
        assert_eq!(asked.get(), 0);

        assert!(!budget.charge(LOAD_MAX_WORK, at, &mut reporter, &files)?);
        assert!(!budget.charge(1, at, &mut reporter, &files)?);
        assert_eq!(asked.get(), 1);

        Ok(())
    }

    #[test]
    fn a_charge_over_the_limit_at_a_site_outside_its_file_is_an_internal_error() {
        let (files, _) = site_in_one_file();
        let mut other_files = SourceFiles::new();
        let _ = other_files.add("a.yaml", "").expect("the file is added");
        let _ = other_files.add("b.yaml", "").expect("the file is added");
        let stranger = Span::new(
            other_files.add("c.yaml", "x").expect("the file is added"),
            TextSize::from(0),
            TextSize::from(1),
        );
        let mut reporter = Reporter::new();
        let mut budget = LoadBudget::new();

        assert!(
            budget
                .charge(LOAD_MAX_WORK + 1, || stranger, &mut reporter, &files)
                .is_err()
        );
    }

    #[test]
    fn the_work_of_a_text_is_one_unit_and_one_more_per_256_utf16_units() {
        let cases = [
            ("", 1),
            ("a", 1),
            (&"a".repeat(255), 1),
            (&"a".repeat(256), 2),
            (&"a".repeat(511), 2),
            (&"a".repeat(512), 3),
            // 128 astral characters are 256 UTF-16 units.
            (&"\u{1F600}".repeat(127), 1),
            (&"\u{1F600}".repeat(128), 2),
            // A BMP character is one unit, though two bytes.
            (&"é".repeat(255), 1),
            (&"é".repeat(256), 2),
        ];

        for (text, expected) in cases {
            assert_eq!(
                load_work_of(text),
                expected,
                "{} characters",
                text.chars().count()
            );
        }
    }

    #[test]
    fn length_counts_utf16_units() {
        assert_eq!(utf16_length(""), 0);
        assert_eq!(utf16_length("é"), 1);
        assert_eq!(utf16_length("\u{E000}"), 1);
        assert_eq!(utf16_length("\u{1F600}"), 2);
        assert_eq!(utf16_length("a\u{10FFFF}"), 3);
    }
}
