use std::borrow::Borrow;
use std::cmp::Ordering;

use indexmap::IndexMap;
use seampact_js::{cmp_utf16, is_ecmascript_white_space};
use seampact_span::Location;

use crate::text::is_active_character;
use crate::{Diagnostic, DiagnosticOrigin};

const UNKNOWN: PrintedLocation<'static> = PrintedLocation {
    file: "(unknown location)",
    line: 0,
    column: 0,
};

/// The last code point an escape writes with four hex digits.
const BASIC_PLANE_LAST: u32 = 0xFFFF;

const SENTENCE_ENDINGS: [char; 3] = ['.', '!', '?'];

/// The position a diagnostic is printed at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrintedLocation<'table> {
    /// The workspace-relative file, or `(unknown location)`.
    pub file: &'table str,
    /// The 1-based line, 0 when unknown.
    pub line: u32,
    /// The 1-based UTF-16 column, 0 when unknown.
    pub column: u32,
}

/// The side table key of `origin`, `"<layer>#<pointer>"` (ADR 0004 section 11). The table
/// belongs to one api, so the origin's api is never part of it.
#[must_use]
pub fn diagnostic_location_key(origin: &DiagnosticOrigin) -> String {
    format!("{}#{}", origin.layer, origin.pointer)
}

/// Where `origin` is printed: its entry of `locations` (the table of the api it belongs to,
/// or the workspace's for load diagnostics), `(unknown location):0:0` without one.
#[must_use]
pub fn diagnostic_location<'table>(
    origin: &DiagnosticOrigin,
    locations: &'table IndexMap<String, Location>,
) -> PrintedLocation<'table> {
    let key = diagnostic_location_key(origin);

    locations
        .get(&key)
        .map_or(UNKNOWN, |location| PrintedLocation {
            file: &location.file,
            line: location.line,
            column: location.column,
        })
}

fn compare_locations(left: &PrintedLocation<'_>, right: &PrintedLocation<'_>) -> Ordering {
    cmp_utf16(left.file, right.file)
        .then_with(|| left.line.cmp(&right.line))
        .then_with(|| left.column.cmp(&right.column))
}

fn sorted_by_location<'table, Item: Borrow<Diagnostic>>(
    diagnostics: impl IntoIterator<Item = Item>,
    locations: &'table IndexMap<String, Location>,
) -> Vec<(PrintedLocation<'table>, Item)> {
    let mut located: Vec<(PrintedLocation<'table>, Item)> = diagnostics
        .into_iter()
        .map(|item| (diagnostic_location(&item.borrow().origin, locations), item))
        .collect();

    located.sort_by(|(left_at, left), (right_at, right)| {
        let left = left.borrow();
        let right = right.borrow();

        compare_locations(left_at, right_at)
            .then_with(|| cmp_utf16(left.rule.as_str(), right.rule.as_str()))
            .then_with(|| cmp_utf16(&left.message, &right.message))
    });

    located
}

/// ADR 0006 section 4: sorted by file, line, column, then rule; the message breaks any
/// remaining tie, and the sort is stable.
#[must_use]
pub fn diagnostic_sort(
    diagnostics: Vec<Diagnostic>,
    locations: &IndexMap<String, Location>,
) -> Vec<Diagnostic> {
    sorted_by_location(diagnostics, locations)
        .into_iter()
        .map(|(_, diagnostic)| diagnostic)
        .collect()
}

/// Authored text made safe for a terminal: every Cc, Cf, Zl and Zp character (an escape
/// sequence, a bidirectional override, a zero-width joiner) is written as `\uXXXX`, or
/// `\u{XXXXX}` beyond the basic plane. The printer applies it to every message; a stage
/// applies it to authored text when it builds a message, so any renderer gets inert text.
#[must_use]
pub fn diagnostic_inert(text: &str) -> String {
    let mut inert = String::with_capacity(text.len());

    for character in text.chars() {
        if !is_active_character(character) {
            inert.push(character);

            continue;
        }

        let code = u32::from(character);
        let escape = if code > BASIC_PLANE_LAST {
            format!("\\u{{{code:X}}}")
        } else {
            format!("\\u{code:04X}")
        };

        inert.push_str(&escape);
    }

    inert
}

// `text.replace(/\s+/g, " ")`: each run of ECMAScript white space becomes one space.
fn collapse_white_space(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut in_white_space = false;

    for character in text.chars() {
        if !is_ecmascript_white_space(character) {
            collapsed.push(character);
            in_white_space = false;

            continue;
        }

        if !in_white_space {
            collapsed.push(' ');
        }

        in_white_space = true;
    }

    collapsed
}

fn sentence(text: &str) -> String {
    let collapsed = collapse_white_space(text);
    // After the collapse, the only white space left at either end is a single space.
    let inert = diagnostic_inert(collapsed.trim_matches(' '));

    if inert.ends_with(SENTENCE_ENDINGS) {
        inert
    } else {
        format!("{inert}.")
    }
}

/// One line per diagnostic in the form editors read, related locations indented below it.
/// No colour, no absolute path (the table holds workspace-relative files), no character a
/// terminal acts on. Lines are joined with `\n`; the caller ends the output.
#[must_use]
pub fn print_diagnostics(
    diagnostics: &[Diagnostic],
    locations: &IndexMap<String, Location>,
) -> String {
    let mut lines: Vec<String> = Vec::new();

    for (at, diagnostic) in sorted_by_location(diagnostics, locations) {
        lines.push(format!(
            "{}:{}:{}: {} {}: {} Fix: {}",
            diagnostic_inert(at.file),
            at.line,
            at.column,
            diagnostic.severity,
            diagnostic.rule,
            sentence(&diagnostic.message),
            sentence(&diagnostic.fix)
        ));

        let mut related: Vec<(PrintedLocation<'_>, &str)> = diagnostic
            .related
            .iter()
            .map(|item| {
                (
                    diagnostic_location(&item.origin, locations),
                    item.message.as_str(),
                )
            })
            .collect();

        related.sort_by(|(left_at, left_message), (right_at, right_message)| {
            compare_locations(left_at, right_at)
                .then_with(|| cmp_utf16(left_message, right_message))
        });

        for (related_at, message) in related {
            lines.push(format!(
                "  {}:{}:{}: {}",
                diagnostic_inert(related_at.file),
                related_at.line,
                related_at.column,
                sentence(message)
            ));
        }
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_white_space_run_becomes_one_space_and_the_ends_are_trimmed() {
        assert_eq!(sentence(" a \t\n b\u{2028}c\u{FEFF} "), "a b c.");
    }

    #[test]
    fn a_sentence_keeps_its_own_ending() {
        assert_eq!(sentence("done!"), "done!");
        assert_eq!(sentence("why?"), "why?");
        assert_eq!(sentence("end. "), "end.");
    }

    #[test]
    fn next_line_is_no_white_space_and_is_escaped() {
        assert_eq!(sentence("a\u{85}b"), "a\\u0085b.");
    }

    #[test]
    fn an_escaped_ending_still_gets_a_period() {
        assert_eq!(sentence("a\u{7}"), "a\\u0007.");
    }
}
