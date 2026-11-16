//! `RegExp.prototype.source`: the text a pattern reads back as.

/// What `RegExp.prototype.source` answers for a pattern written as `written`: `(?:)` for the empty
/// pattern, a `/` outside a class written `\/`, a line terminator written as its escape.
#[must_use]
pub fn regexp_source(written: &str) -> String {
    if written.is_empty() {
        return "(?:)".to_owned();
    }

    let mut source = String::with_capacity(written.len());
    let mut in_class = false;
    let mut escaped = false;

    for character in written.chars() {
        if escaped {
            escaped = false;
            source.push_str(
                &line_terminator_escape(character)
                    .map_or_else(|| format!("\\{character}"), ToOwned::to_owned),
            );

            continue;
        }

        match character {
            '\\' => escaped = true,
            '[' => {
                in_class = true;
                source.push(character);
            }
            ']' => {
                in_class = false;
                source.push(character);
            }
            '/' if !in_class => source.push_str("\\/"),
            other => source
                .push_str(line_terminator_escape(other).unwrap_or(other.encode_utf8(&mut [0; 4]))),
        }
    }

    if escaped {
        source.push('\\');
    }

    source
}

const fn line_terminator_escape(character: char) -> Option<&'static str> {
    match character {
        '\n' => Some("\\n"),
        '\r' => Some("\\r"),
        '\u{2028}' => Some("\\u2028"),
        '\u{2029}' => Some("\\u2029"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each pair is `new RegExp(written).source` as Node prints it.
    #[test]
    fn a_source_is_what_node_answers() {
        for (written, source) in [
            ("", "(?:)"),
            ("^a/b$", "^a\\/b$"),
            ("[/]", "[/]"),
            ("a\\/b", "a\\/b"),
            ("a\nb", "a\\nb"),
            ("a\u{2028}b", "a\\u2028b"),
            ("a\u{2029}b", "a\\u2029b"),
            ("\r", "\\r"),
            ("\\\nb", "\\nb"),
            ("\\[/", "\\[\\/"),
            ("[\\]/]", "[\\]/]"),
            ("\\\u{2028}x", "\\u2028x"),
            ("a/[/]/b", "a\\/[/]\\/b"),
        ] {
            assert_eq!(regexp_source(written), source, "pattern {written:?}");
        }
    }
}
