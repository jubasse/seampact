//! Formats generated TypeScript and JavaScript with oxc's formatter at Prettier's settings.
//!
//! [`format_source`] is the one function over oxc: no other crate names an `oxc_*` type, so the
//! git pin moves behind it alone.

use oxc_allocator::Allocator;
use oxc_formatter::{JsFormatOptions, format};
use oxc_span::SourceType;

/// The language a generated source is parsed as.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SourceKind {
    /// `.ts` and `.tsx`, Prettier's `typescript` parser.
    TypeScript,
    /// `.js`, `.mjs` and `.cjs`, Prettier's `babel` parser.
    JavaScript,
}

impl SourceKind {
    /// The parser name Prettier gives the kind, as a refusal names it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TypeScript => "typescript",
            Self::JavaScript => "babel",
        }
    }
}

/// Why a source could not be formatted.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FormatSourceError {
    /// The source does not parse as its kind.
    #[error("the source does not parse as {kind}: {message}")]
    Parse {
        /// The parser the source was read with.
        kind: &'static str,
        /// The parser's first diagnostic.
        message: String,
    },
    /// The formatter could not print the parsed source.
    #[error("the formatter could not print the source: {message}")]
    Print {
        /// The printer's error.
        message: String,
    },
}

/// Formats `source` as `kind` with Prettier's defaults (80 columns, 2-space indents, double
/// quotes, semicolons, trailing commas everywhere).
///
/// TypeScript is read without JSX first, then with it, as Prettier's `typescript` parser does, so
/// a `.tsx` file and a `.ts` file holding a generic arrow both parse.
///
/// # Errors
///
/// [`FormatSourceError::Parse`] when the source parses as neither form of its kind,
/// [`FormatSourceError::Print`] when the printer fails.
pub fn format_source(source: &str, kind: SourceKind) -> Result<String, FormatSourceError> {
    let source_types: &[SourceType] = match kind {
        SourceKind::TypeScript => &[SourceType::ts(), SourceType::tsx()],
        SourceKind::JavaScript => &[SourceType::mjs()],
    };
    let mut first_parse_error = None;

    for source_type in source_types {
        match format_as(source, *source_type) {
            Ok(formatted) => return Ok(formatted),
            Err(FailedAttempt::Parse(message)) => {
                first_parse_error.get_or_insert(message);
            }
            Err(FailedAttempt::Print(message)) => return Err(FormatSourceError::Print { message }),
        }
    }

    Err(FormatSourceError::Parse {
        kind: kind.as_str(),
        message: first_parse_error.unwrap_or_default(),
    })
}

/// Why one parse-and-print attempt failed, before the kind is known to the caller.
enum FailedAttempt {
    Parse(String),
    Print(String),
}

fn format_as(source: &str, source_type: SourceType) -> Result<String, FailedAttempt> {
    let allocator = Allocator::default();
    let formatted = format(&allocator, source, source_type, JsFormatOptions::default())
        .map_err(|diagnostic| FailedAttempt::Parse(diagnostic.to_string()))?;
    let printed = formatted
        .print()
        .map_err(|error| FailedAttempt::Print(error.to_string()))?;

    Ok(printed.into_code())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_typescript_as_prettier_writes_it() {
        let formatted =
            format_source("export const a = {b:1,c:'x'}\n", SourceKind::TypeScript).unwrap();

        assert_eq!(formatted, "export const a = { b: 1, c: \"x\" };\n");
    }

    #[test]
    fn reads_jsx_in_typescript_after_plain_typescript() {
        let formatted =
            format_source("export const a = <div/>\n", SourceKind::TypeScript).unwrap();

        assert_eq!(formatted, "export const a = <div />;\n");
    }

    #[test]
    fn refuses_a_source_that_does_not_parse() {
        let refused = format_source("export const = ;\n", SourceKind::JavaScript);

        assert!(
            matches!(refused, Err(FormatSourceError::Parse { kind: "babel", .. })),
            "{refused:?}"
        );
    }

    #[test]
    fn formatting_is_idempotent() {
        let source = "export function f(a: string, b: number): Promise<void> { return g(a, b) }\n";
        let once = format_source(source, SourceKind::TypeScript).unwrap();
        let twice = format_source(&once, SourceKind::TypeScript).unwrap();

        assert_eq!(once, twice, "source {source:?}");
    }
}
