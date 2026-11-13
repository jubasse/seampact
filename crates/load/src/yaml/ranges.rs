//! The `range` of a `yaml` package node, found again in the text around a parser event.
//!
//! The parser's spans start at a node's properties (`&anchor`, `!tag`), the `yaml` package's
//! `range[0]` after them; a block scalar's span starts at its content when it has no properties,
//! the `yaml` range at its `|` or `>`; an empty node sits after the `:` or `-` that introduces
//! it. These functions read what the parser leaves out from the text itself.

const BLANKS: [u8; 2] = *b" \t";
const FLOW_INDICATORS: [u8; 4] = *b",[]}";

/// The properties at the start of a node.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Properties {
    /// The name after the `&`, when there is an anchor.
    pub(super) anchor: Option<String>,
    /// The end of the last property.
    pub(super) last_end: usize,
    /// The first byte after the properties and the white space, comments and line breaks that
    /// follow them; `from` when there is no property.
    pub(super) after: usize,
}

fn byte_at(text: &str, position: usize) -> Option<u8> {
    text.as_bytes().get(position).copied()
}

fn is_blank_or_break(byte: u8) -> bool {
    BLANKS.contains(&byte) || byte == b'\n'
}

/// The properties written from `from`: an anchor and a tag, in either order.
pub(super) fn scan_properties(text: &str, from: usize) -> Properties {
    let mut properties = Properties {
        anchor: None,
        last_end: from,
        after: from,
    };
    let mut position = from;

    while let Some(indicator @ (b'&' | b'!')) = byte_at(text, position) {
        let token_end = property_end(text, position, indicator);

        if indicator == b'&' && properties.anchor.is_none() {
            properties.anchor = text.get(position + 1..token_end).map(ToOwned::to_owned);
        }

        properties.last_end = token_end;
        position = skip_gap(text, token_end);
        properties.after = position;
    }

    properties
}

/// The end of the property token that starts at `start`: a verbatim tag `!<...>` ends at its `>`,
/// any other at white space or a flow indicator.
fn property_end(text: &str, start: usize, indicator: u8) -> usize {
    let verbatim = indicator == b'!' && byte_at(text, start + 1) == Some(b'<');
    let mut position = start + 1;

    while let Some(byte) = byte_at(text, position) {
        if verbatim && byte == b'>' {
            return position + 1;
        }

        if !verbatim && (is_blank_or_break(byte) || FLOW_INDICATORS.contains(&byte)) {
            break;
        }

        position += 1;
    }

    position
}

/// Past the white space, line breaks and comments from `from`. A comment needs white space before
/// it, which the caller's token end does not give: only a gap that began with white space holds one.
fn skip_gap(text: &str, from: usize) -> usize {
    let mut position = from;
    let mut after_white_space = false;

    while let Some(byte) = byte_at(text, position) {
        if is_blank_or_break(byte) {
            after_white_space = true;
            position += 1;
        } else if byte == b'#' && after_white_space {
            position = line_end(text, position);
        } else {
            break;
        }
    }

    position
}

/// The offset of the line break that ends the line holding `from`, or the end of the text.
fn line_end(text: &str, from: usize) -> usize {
    text.as_bytes()
        .get(from..)
        .and_then(|rest| rest.iter().position(|byte| *byte == b'\n'))
        .map_or(text.len(), |offset| from + offset)
}

/// Past the spaces and tabs from `from`, on the same line.
pub(super) fn skip_blanks(text: &str, from: usize) -> usize {
    let mut position = from;

    while byte_at(text, position).is_some_and(|byte| BLANKS.contains(&byte)) {
        position += 1;
    }

    position
}

/// The `yaml` package's `range[2]` of a value that ends at `value_end`: the white space, a
/// comment and the first line break that follow it.
pub(super) fn trailing_end(text: &str, value_end: usize) -> usize {
    let after_blanks = skip_blanks(text, value_end);
    let comment_follows = after_blanks > value_end && byte_at(text, after_blanks) == Some(b'#');
    let content_end = if comment_follows {
        line_end(text, after_blanks)
    } else {
        after_blanks
    };

    if byte_at(text, content_end) == Some(b'\n') {
        return content_end + 1;
    }

    content_end
}

/// Where the header of a block scalar starts when the parser's span starts at the content.
///
/// The header is the last non-blank line before the content, and on it the first `|` or `>`
/// followed only by indentation and chomping indicators, white space and a comment. `content_start`
/// is returned when no header is found.
pub(super) fn block_header_start(text: &str, content_start: usize) -> usize {
    let Some(before) = text.get(..content_start) else {
        return content_start;
    };
    let trimmed = before.trim_end_matches([' ', '\t', '\n']);
    let line_start = trimmed.rfind('\n').map_or(0, |line_break| line_break + 1);
    let Some(line) = trimmed.get(line_start..) else {
        return content_start;
    };

    for (offset, character) in line.char_indices() {
        let is_indicator = character == '|' || character == '>';
        let tail = line.get(offset + 1..).unwrap_or("");

        if is_indicator && is_header_tail(tail) {
            return line_start + offset;
        }
    }

    content_start
}

/// The `-` that starts a block sequence. The parser's span starts there, except for a sequence
/// written at the indentation of its key (`a:\n- x`), where it starts at the first item.
pub(super) fn sequence_indicator_start(text: &str, start: usize) -> usize {
    let at_indicator = byte_at(text, start) == Some(b'-')
        && byte_at(text, start + 1).is_none_or(is_blank_or_break);

    if at_indicator {
        return start;
    }

    let mut position = start;

    while position > 0 && byte_at(text, position - 1).is_some_and(is_blank_or_break) {
        position -= 1;
    }

    match position.checked_sub(1) {
        Some(indicator) if byte_at(text, indicator) == Some(b'-') => indicator,
        _ => start,
    }
}

/// The end of the quoted scalar that starts at `start`, after its closing quote: the parser's span
/// goes on to the comment that follows. `None` when the quote never closes.
pub(super) fn quoted_end(text: &str, start: usize) -> Option<usize> {
    let quote = byte_at(text, start)?;
    let mut position = start + 1;

    while let Some(byte) = byte_at(text, position) {
        if quote == b'"' && byte == b'\\' {
            position += 2;

            continue;
        }

        if byte == quote {
            // A doubled single quote is an escaped one.
            if quote == b'\'' && byte_at(text, position + 1) == Some(b'\'') {
                position += 2;

                continue;
            }

            return Some(position + 1);
        }

        position += 1;
    }

    None
}

/// Where the `yaml` package ends a block scalar whose header starts at `header_start`: the
/// parser's end, less the blank lines after the last content line, which only the keep indicator
/// (`|+`) puts in the scalar.
pub(super) fn block_scalar_end(text: &str, header_start: usize, parser_end: usize) -> usize {
    let Some(scalar) = text.get(header_start..parser_end) else {
        return parser_end;
    };
    let header = scalar.lines().next().unwrap_or("");
    let indicators: String = header
        .chars()
        .skip(1)
        .take_while(|character| {
            character.is_ascii_digit() || *character == '+' || *character == '-'
        })
        .collect();

    if indicators.contains('+') {
        return parser_end;
    }

    let last_content = scalar.trim_end_matches([' ', '\t', '\n']);
    let after_content = header_start + last_content.len();

    match text.as_bytes().get(after_content..parser_end) {
        Some(rest) => match rest.iter().position(|byte| *byte == b'\n') {
            Some(offset) => after_content + offset + 1,
            None => parser_end,
        },
        None => parser_end,
    }
}

/// What may follow the `|` or `>` of a block scalar header on its line.
fn is_header_tail(tail: &str) -> bool {
    let after_indicators = tail.trim_start_matches(|character: char| {
        character.is_ascii_digit() || character == '+' || character == '-'
    });
    let after_blanks = after_indicators.trim_start_matches([' ', '\t']);

    after_blanks.is_empty()
        || (after_blanks.starts_with('#') && after_blanks.len() < after_indicators.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn properties_in_either_order() {
        let text = "!!map &a\n  b: 1";
        let properties = scan_properties(text, 0);

        assert_eq!(properties.anchor.as_deref(), Some("a"));
        assert_eq!(properties.last_end, 8);
        assert_eq!(properties.after, 11);

        let reversed = scan_properties("&a !!map x", 0);

        assert_eq!(reversed.anchor.as_deref(), Some("a"));
        assert_eq!(reversed.after, 9);
    }

    #[test]
    fn no_property_leaves_the_position_alone() {
        let properties = scan_properties("  x", 0);

        assert_eq!(
            properties,
            Properties {
                anchor: None,
                last_end: 0,
                after: 0
            }
        );
    }

    #[test]
    fn a_comment_after_the_properties_is_skipped() {
        let text = "&x # c\n  b: 1";

        assert_eq!(scan_properties(text, 0).after, 9);
    }

    #[test]
    fn a_verbatim_tag_and_a_flow_indicator() {
        let verbatim = scan_properties("!<tag:yaml.org,2002:str> v", 0);

        assert_eq!(verbatim.last_end, 24);
        assert_eq!(verbatim.after, 25);

        let in_flow = scan_properties("&a,", 0);

        assert_eq!(in_flow.anchor.as_deref(), Some("a"));
        assert_eq!(in_flow.after, 2);
    }

    #[test]
    fn a_non_ascii_anchor_name() {
        let properties = scan_properties("&é😀 x", 0);

        assert_eq!(properties.anchor.as_deref(), Some("é😀"));
    }

    #[test]
    fn trailing_end_takes_blanks_a_comment_and_one_line_break() {
        assert_eq!(trailing_end("a: 1\nb", 4), 5);
        assert_eq!(trailing_end("a: 1 # c\n\nb", 4), 9);
        assert_eq!(trailing_end("a: 1  \n", 4), 7);
        assert_eq!(trailing_end("a: 1", 4), 4);
        assert_eq!(trailing_end("a: 1#c", 4), 4);
    }

    #[test]
    fn a_block_header_is_found_before_the_content() {
        assert_eq!(block_header_start("k: |\n  text\n", 7), 3);
        assert_eq!(block_header_start("k: >-\n\n  text\n", 9), 3);
        assert_eq!(block_header_start("k: |2+ # note | x\n  text\n", 20), 3);
        assert_eq!(block_header_start("\"a|b\": |\n  t\n", 11), 7);
    }

    #[test]
    fn a_sequence_starts_at_its_dash() {
        assert_eq!(sequence_indicator_start("a:\n  - x", 5), 5);
        assert_eq!(sequence_indicator_start("a:\n- x", 5), 3);
        assert_eq!(sequence_indicator_start("-\n  x", 4), 0);
        assert_eq!(sequence_indicator_start("x", 0), 0);
    }

    #[test]
    fn a_quoted_scalar_ends_at_its_closing_quote() {
        assert_eq!(quoted_end("\"q\"  # z", 0), Some(3));
        assert_eq!(quoted_end("'it''s' x", 0), Some(7));
        assert_eq!(quoted_end("\"a\\\"b\" x", 0), Some(6));
        assert_eq!(quoted_end("\"multi\n  line\" x", 0), Some(14));
        assert_eq!(quoted_end("\"open", 0), None);
    }

    #[test]
    fn a_block_scalar_ends_after_its_last_content_line() {
        let text = "a: |\n  t\n\nb: 1";

        assert_eq!(block_scalar_end(text, 3, 10), 9);
        assert_eq!(block_scalar_end("a: |+\n  t\n\nb", 3, 11), 11);
        assert_eq!(block_scalar_end("a: |\nb: 1", 3, 5), 5);
        assert_eq!(block_scalar_end("a: |\n  t", 3, 8), 8);
    }

    #[test]
    fn no_header_gives_the_content_start() {
        assert_eq!(block_header_start("text", 0), 0);
        assert_eq!(block_header_start("a: b\n", 3), 3);
    }
}
