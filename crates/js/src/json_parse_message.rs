//! The message V8 gives when `JSON.parse` refuses a text.
//!
//! Node prints it into the diagnostics of the TypeScript compiler (`error.message`), so a Rust
//! reader that refuses the same text writes the same words. Positions count UTF-16 code units.

/// The longest run of characters V8 shows on each side of an unexpected token.
const CONTEXT_UNITS: usize = 10;

/// A source this long or longer is shown as a window around the unexpected token.
const MIN_SOURCE_UNITS_FOR_CONTEXT: usize = CONTEXT_UNITS * 2 + 1;

/// The texts V8 quotes whole instead of naming a token.
const SPECIAL_SOURCES: [&str; 4] = ["NaN", "Infinity", "undefined", "[object Object]"];

const END_OF_INPUT: &str = "Unexpected end of JSON input";

const UNTERMINATED_STRING: &str = "Unterminated string in JSON";
const BAD_CONTROL_CHARACTER: &str = "Bad control character in string literal in JSON";
const BAD_ESCAPED_CHARACTER: &str = "Bad escaped character in JSON";
const BAD_UNICODE_ESCAPE: &str = "Bad Unicode escape in JSON";
const NO_NUMBER_AFTER_MINUS: &str = "No number after minus sign in JSON";
const UNTERMINATED_FRACTION: &str = "Unterminated fractional number in JSON";
const MISSING_EXPONENT: &str = "Exponent part is missing a number in JSON";
const UNEXPECTED_NUMBER: &str = "Unexpected number in JSON";
const EXPECTED_PROPERTY_NAME_OR_BRACE: &str = "Expected property name or '}' in JSON";
const EXPECTED_QUOTED_PROPERTY_NAME: &str = "Expected double-quoted property name in JSON";
const EXPECTED_COLON: &str = "Expected ':' after property name in JSON";
const EXPECTED_COMMA_OR_BRACE: &str = "Expected ',' or '}' after property value in JSON";
const EXPECTED_COMMA_OR_BRACKET: &str = "Expected ',' or ']' after array element in JSON";
const TRAILING_CHARACTER: &str = "Unexpected non-whitespace character after JSON";

/// What V8's `JSON.parse(text)` throws as `error.message`, or `None` when it parses the text.
///
/// The words are those of the Node version the TypeScript compiler runs on (24): a position and
/// its line and column for a refusal at a known place, the unexpected token inside a window of the
/// text otherwise.
#[must_use]
pub fn json_parse_error_message(text: &str) -> Option<String> {
    let units: Vec<u16> = text.encode_utf16().collect();
    let failure = Scanner::new(&units).document().err()?;

    Some(failure.message(&units, text))
}

/// Where and why the scan stopped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Failure {
    /// A refusal V8 words with its place.
    At {
        message: &'static str,
        position: usize,
    },
    /// A token that cannot start or continue a value, or the end of the text.
    Token { position: usize },
}

impl Failure {
    fn message(self, units: &[u16], text: &str) -> String {
        match self {
            Self::At { message, position } => {
                let (line, column) = line_and_column(units, position);

                format!("{message} at position {position} (line {line} column {column})")
            }
            Self::Token { position } => token_message(units, text, position),
        }
    }
}

fn token_message(units: &[u16], text: &str, position: usize) -> String {
    let Some(unit) = units.get(position) else {
        return END_OF_INPUT.to_owned();
    };

    if SPECIAL_SOURCES.contains(&text) {
        return format!("\"{text}\" is not valid JSON");
    }

    // A lone surrogate prints as U+FFFD, as Node prints it.
    let token = char::decode_utf16([*unit])
        .next()
        .and_then(Result::ok)
        .unwrap_or(char::REPLACEMENT_CHARACTER);

    format!(
        "Unexpected token '{token}', {} is not valid JSON",
        quoted_source(units, position)
    )
}

/// The whole text, or a window of it around `position`, in quotes with an ellipsis for each cut.
fn quoted_source(units: &[u16], position: usize) -> String {
    if units.len() < MIN_SOURCE_UNITS_FOR_CONTEXT {
        return format!("\"{}\"", String::from_utf16_lossy(units));
    }

    let start = position.saturating_sub(CONTEXT_UNITS);
    let end = (position + CONTEXT_UNITS).min(units.len());
    let window = units.get(start..end).unwrap_or_default();
    let before = if start > 0 { "..." } else { "" };
    let after = if end < units.len() { "..." } else { "" };

    format!("{before}\"{}\"{after}", String::from_utf16_lossy(window))
}

/// The 1-based line and column of `position`; `\r\n` is one line break.
fn line_and_column(units: &[u16], position: usize) -> (usize, usize) {
    let mut line = 1;
    let mut line_start = 0;
    let mut index = 0;

    while index < position {
        match units.get(index) {
            Some(&unit) if unit == u16::from(b'\n') => {
                line += 1;
                line_start = index + 1;
            }
            Some(&unit) if unit == u16::from(b'\r') => {
                if units.get(index + 1) == Some(&u16::from(b'\n')) {
                    index += 1;
                }

                line += 1;
                line_start = index + 1;
            }
            _ => {}
        }

        index += 1;
    }

    (line, position - line_start + 1)
}

/// What an open bracket waits for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Open {
    Array,
    Object,
}

struct Scanner<'text> {
    units: &'text [u16],
    position: usize,
}

impl<'text> Scanner<'text> {
    const fn new(units: &'text [u16]) -> Self {
        Self { units, position: 0 }
    }

    fn peek(&self) -> Option<u16> {
        self.units.get(self.position).copied()
    }

    fn peek_is(&self, expected: u8) -> bool {
        self.peek() == Some(u16::from(expected))
    }

    fn skip_white_space(&mut self) {
        while matches!(self.peek(), Some(0x20 | 0x09 | 0x0A | 0x0D)) {
            self.position += 1;
        }
    }

    const fn at(&self, message: &'static str) -> Failure {
        Failure::At {
            message,
            position: self.position,
        }
    }

    const fn token(&self) -> Failure {
        Failure::Token {
            position: self.position,
        }
    }

    /// One JSON text: a value and nothing after it but white space.
    fn document(&mut self) -> Result<(), Failure> {
        let mut open: Vec<Open> = Vec::new();

        loop {
            if self.value_start(&mut open)? {
                continue;
            }

            if self.value_end(&mut open)? {
                return Ok(());
            }
        }
    }

    /// Reads the start of a value. `true` when it opened a container that now waits for its first
    /// member's value, so the next token is another value.
    fn value_start(&mut self, open: &mut Vec<Open>) -> Result<bool, Failure> {
        self.skip_white_space();

        match self.peek().and_then(|unit| u8::try_from(unit).ok()) {
            Some(b'{') => {
                self.position += 1;
                self.skip_white_space();

                if self.peek_is(b'}') {
                    self.position += 1;

                    return Ok(false);
                }

                if !self.peek_is(b'"') {
                    return Err(self.at(EXPECTED_PROPERTY_NAME_OR_BRACE));
                }

                open.push(Open::Object);
                self.property_name_and_colon()?;

                Ok(true)
            }
            Some(b'[') => {
                self.position += 1;
                self.skip_white_space();

                if self.peek_is(b']') {
                    self.position += 1;

                    return Ok(false);
                }

                open.push(Open::Array);

                Ok(true)
            }
            Some(b'"') => {
                self.string()?;

                Ok(false)
            }
            Some(b'-' | b'0'..=b'9') => {
                self.number()?;

                Ok(false)
            }
            Some(b't') => self.literal("true").map(|()| false),
            Some(b'f') => self.literal("false").map(|()| false),
            Some(b'n') => self.literal("null").map(|()| false),
            _ => Err(self.token()),
        }
    }

    /// Reads what follows a finished value. `true` when the text is complete, `false` when a comma
    /// announced another value.
    fn value_end(&mut self, open: &mut Vec<Open>) -> Result<bool, Failure> {
        loop {
            self.skip_white_space();

            let Some(container) = open.last().copied() else {
                if self.position < self.units.len() {
                    return Err(self.at(TRAILING_CHARACTER));
                }

                return Ok(true);
            };

            match (
                container,
                self.peek().and_then(|unit| u8::try_from(unit).ok()),
            ) {
                (Open::Array, Some(b',')) => {
                    self.position += 1;

                    return Ok(false);
                }
                (Open::Object, Some(b',')) => {
                    self.position += 1;
                    self.skip_white_space();

                    if !self.peek_is(b'"') {
                        return Err(self.at(EXPECTED_QUOTED_PROPERTY_NAME));
                    }

                    self.property_name_and_colon()?;

                    return Ok(false);
                }
                (Open::Array, Some(b']')) | (Open::Object, Some(b'}')) => {
                    self.position += 1;
                    open.pop();
                }
                (Open::Array, _) => return Err(self.at(EXPECTED_COMMA_OR_BRACKET)),
                (Open::Object, _) => return Err(self.at(EXPECTED_COMMA_OR_BRACE)),
            }
        }
    }

    fn property_name_and_colon(&mut self) -> Result<(), Failure> {
        self.string()?;
        self.skip_white_space();

        if !self.peek_is(b':') {
            return Err(self.at(EXPECTED_COLON));
        }

        self.position += 1;

        Ok(())
    }

    fn literal(&mut self, word: &str) -> Result<(), Failure> {
        for expected in word.bytes() {
            if self.peek() != Some(u16::from(expected)) {
                return Err(self.token());
            }

            self.position += 1;
        }

        Ok(())
    }

    fn string(&mut self) -> Result<(), Failure> {
        self.position += 1;

        loop {
            let Some(unit) = self.peek() else {
                return Err(self.at(UNTERMINATED_STRING));
            };

            if unit == u16::from(b'"') {
                self.position += 1;

                return Ok(());
            }

            if unit < 0x20 {
                return Err(self.at(BAD_CONTROL_CHARACTER));
            }

            self.position += 1;

            if unit == u16::from(b'\\') {
                self.escape()?;
            }
        }
    }

    /// The character after a backslash.
    fn escape(&mut self) -> Result<(), Failure> {
        let Some(unit) = self.peek() else {
            return Err(self.token());
        };

        match u8::try_from(unit) {
            Ok(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't') => {
                self.position += 1;

                Ok(())
            }
            Ok(b'u') => {
                self.position += 1;

                for _ in 0..4 {
                    let is_hex = self
                        .peek()
                        .and_then(|digit| char::from_u32(u32::from(digit)))
                        .is_some_and(|digit| digit.is_ascii_hexdigit());

                    if !is_hex {
                        return Err(self.at(BAD_UNICODE_ESCAPE));
                    }

                    self.position += 1;
                }

                Ok(())
            }
            _ => Err(self.at(BAD_ESCAPED_CHARACTER)),
        }
    }

    fn digits(&mut self) -> usize {
        let start = self.position;

        while self.peek().is_some_and(is_digit) {
            self.position += 1;
        }

        self.position - start
    }

    fn number(&mut self) -> Result<(), Failure> {
        if self.peek_is(b'-') {
            self.position += 1;

            if !self.peek().is_some_and(is_digit) {
                return Err(self.at(NO_NUMBER_AFTER_MINUS));
            }
        }

        if self.peek_is(b'0') {
            self.position += 1;

            if self.peek().is_some_and(is_digit) {
                return Err(self.at(UNEXPECTED_NUMBER));
            }
        } else {
            self.digits();
        }

        if self.peek_is(b'.') {
            self.position += 1;

            if self.digits() == 0 {
                return Err(self.at(UNTERMINATED_FRACTION));
            }
        }

        if self.peek_is(b'e') || self.peek_is(b'E') {
            self.position += 1;

            if self.peek_is(b'+') || self.peek_is(b'-') {
                self.position += 1;
            }

            if self.digits() == 0 {
                return Err(self.at(MISSING_EXPONENT));
            }
        }

        Ok(())
    }
}

fn is_digit(unit: u16) -> bool {
    (u16::from(b'0')..=u16::from(b'9')).contains(&unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_said_of_a_text_v8_parses() {
        for text in [
            "1",
            "-0",
            "0.5e+3",
            "\"a\"",
            "[]",
            "{}",
            " [ 1 , {\"a\" : null} ] \n",
            "true",
            "\"\\u00e9\\ud800\"",
        ] {
            assert_eq!(json_parse_error_message(text), None, "text {text:?}");
        }
    }

    /// Each pair is a text and `JSON.parse`'s `error.message` for it in Node 24, `None` where it
    /// parses.
    const NODE_MESSAGES: &[(&str, Option<&str>)] = &[
        ("", Some("Unexpected end of JSON input")),
        ("  ", Some("Unexpected end of JSON input")),
        ("[1,", Some("Unexpected end of JSON input")),
        (
            "[1] x",
            Some("Unexpected non-whitespace character after JSON at position 4 (line 1 column 5)"),
        ),
        (
            "{a:1}",
            Some("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "{\"a\":1,}",
            Some("Expected double-quoted property name in JSON at position 7 (line 1 column 8)"),
        ),
        (
            "[1,]",
            Some("Unexpected token ']', \"[1,]\" is not valid JSON"),
        ),
        ("tru", Some("Unexpected end of JSON input")),
        ("nul", Some("Unexpected end of JSON input")),
        (
            "\"abc",
            Some("Unterminated string in JSON at position 4 (line 1 column 5)"),
        ),
        (
            "\"a\u{a}b\"",
            Some("Bad control character in string literal in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "\"\\x\"",
            Some("Bad escaped character in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "\"\\u12\"",
            Some("Bad Unicode escape in JSON at position 5 (line 1 column 6)"),
        ),
        (
            "-",
            Some("No number after minus sign in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "1.",
            Some("Unterminated fractional number in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "1e",
            Some("Exponent part is missing a number in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "01",
            Some("Unexpected number in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "[1 2]",
            Some("Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)"),
        ),
        (
            "{\"a\" 1}",
            Some("Expected ':' after property name in JSON at position 5 (line 1 column 6)"),
        ),
        (
            "{\"a\":1 \"b\":2}",
            Some(
                "Expected ',' or '}' after property value in JSON at position 7 (line 1 column 8)",
            ),
        ),
        (
            "{1:2}",
            Some("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "[\"a\":1]",
            Some("Expected ',' or ']' after array element in JSON at position 4 (line 1 column 5)"),
        ),
        ("x", Some("Unexpected token 'x', \"x\" is not valid JSON")),
        ("undefined", Some("\"undefined\" is not valid JSON")),
        (
            "{\"a\":\"verylongvaluehere\",\"b\":x,\"c\":\"morelongvaluehere\"}",
            Some("Unexpected token 'x', ...\"here\",\"b\":x,\"c\":\"mor\"... is not valid JSON"),
        ),
        (
            "a[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]",
            Some("Unexpected token 'a', \"a[1,2,3,4,\"... is not valid JSON"),
        ),
        (
            "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,x]",
            Some("Unexpected token 'x', ...\",12,13,14,x]\" is not valid JSON"),
        ),
        (
            "{",
            Some("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
        ),
        ("[", Some("Unexpected end of JSON input")),
        (
            "{\"a\"",
            Some("Expected ':' after property name in JSON at position 4 (line 1 column 5)"),
        ),
        ("{\"a\":", Some("Unexpected end of JSON input")),
        (
            "[1",
            Some("Expected ',' or ']' after array element in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "\u{e9}",
            Some("Unexpected token '\u{e9}', \"\u{e9}\" is not valid JSON"),
        ),
        (
            "[1]\u{a}\u{a}[2]",
            Some("Unexpected non-whitespace character after JSON at position 5 (line 3 column 1)"),
        ),
        ("+1", Some("Unexpected token '+', \"+1\" is not valid JSON")),
        (".5", Some("Unexpected token '.', \".5\" is not valid JSON")),
        ("NaN", Some("\"NaN\" is not valid JSON")),
        (
            "{\"a\":1}}",
            Some("Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)"),
        ),
        (
            "\"\u{9}\"",
            Some("Bad control character in string literal in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "trux",
            Some("Unexpected token 'x', \"trux\" is not valid JSON"),
        ),
        ("tx", Some("Unexpected token 'x', \"tx\" is not valid JSON")),
        ("fals", Some("Unexpected end of JSON input")),
        (
            "nulx",
            Some("Unexpected token 'x', \"nulx\" is not valid JSON"),
        ),
        ("\"\\", Some("Unexpected end of JSON input")),
        (
            "\"\\u",
            Some("Bad Unicode escape in JSON at position 3 (line 1 column 4)"),
        ),
        (
            "\"\\u12g4\"",
            Some("Bad Unicode escape in JSON at position 5 (line 1 column 6)"),
        ),
        (
            "[1,\u{d}\u{a}x]",
            Some("Unexpected token 'x', \"[1,\u{d}\u{a}x]\" is not valid JSON"),
        ),
        (
            "[1]\u{d}\u{a}\u{d}\u{a}x",
            Some("Unexpected non-whitespace character after JSON at position 7 (line 3 column 1)"),
        ),
        (
            "[1]\u{d}x",
            Some("Unexpected non-whitespace character after JSON at position 4 (line 2 column 1)"),
        ),
        (
            "1.x",
            Some("Unterminated fractional number in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "1e+",
            Some("Exponent part is missing a number in JSON at position 3 (line 1 column 4)"),
        ),
        (
            "1e+x",
            Some("Exponent part is missing a number in JSON at position 3 (line 1 column 4)"),
        ),
        (
            "-x",
            Some("No number after minus sign in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "0.0e",
            Some("Exponent part is missing a number in JSON at position 4 (line 1 column 5)"),
        ),
        (
            "[\u{a}1\u{a}\u{a}2]",
            Some("Expected ',' or ']' after array element in JSON at position 5 (line 4 column 1)"),
        ),
        (
            "{\"a\":}",
            Some("Unexpected token '}', \"{\"a\":}\" is not valid JSON"),
        ),
        (
            "{\"a\":1,\"b\"}",
            Some("Expected ':' after property name in JSON at position 10 (line 1 column 11)"),
        ),
        (
            "[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,x",
            Some("Unexpected token 'x', ...\",18,19,20,x\" is not valid JSON"),
        ),
        (
            "abcdefghijklmnopqrstu",
            Some("Unexpected token 'a', \"abcdefghij\"... is not valid JSON"),
        ),
        (
            "abcdefghijklmnopqrst",
            Some("Unexpected token 'a', \"abcdefghijklmnopqrst\" is not valid JSON"),
        ),
        (
            "[1,2,3,4,5,6,x,1,2,3]",
            Some("Unexpected token 'x', ...\"2,3,4,5,6,x,1,2,3]\" is not valid JSON"),
        ),
        (
            "\u{1f600}",
            Some("Unexpected token '\u{fffd}', \"\u{1f600}\" is not valid JSON"),
        ),
        (
            "[\u{1f600},x]",
            Some("Unexpected token '\u{fffd}', \"[\u{1f600},x]\" is not valid JSON"),
        ),
        ("Infinity", Some("\"Infinity\" is not valid JSON")),
        (
            "[object Object]",
            Some("\"[object Object]\" is not valid JSON"),
        ),
        (
            "\u{a0}",
            Some("Unexpected token '\u{a0}', \"\u{a0}\" is not valid JSON"),
        ),
        (
            "{\"a\":1}x",
            Some("Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)"),
        ),
        (
            "\u{0}",
            Some("Unexpected token '\u{0}', \"\u{0}\" is not valid JSON"),
        ),
        ("tr", Some("Unexpected end of JSON input")),
        (
            "\"\\\u{1}\"",
            Some("Bad escaped character in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "[,]",
            Some("Unexpected token ',', \"[,]\" is not valid JSON"),
        ),
        (
            "{,}",
            Some("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
        ),
        ("}", Some("Unexpected token '}', \"}\" is not valid JSON")),
        ("]", Some("Unexpected token ']', \"]\" is not valid JSON")),
        (
            "{\"a\":[1,{\"b\":tru}]}",
            Some("Unexpected token '}', \"{\"a\":[1,{\"b\":tru}]}\" is not valid JSON"),
        ),
        (
            "[[1,2],[3,4],}",
            Some("Unexpected token '}', \"[[1,2],[3,4],}\" is not valid JSON"),
        ),
        (
            "{\"a\":{\"b\":1}\"c\":2}",
            Some(
                "Expected ',' or '}' after property value in JSON at position 12 (line 1 column 13)",
            ),
        ),
        (
            "[1,2]]",
            Some("Unexpected non-whitespace character after JSON at position 5 (line 1 column 6)"),
        ),
        ("\"abc\\", Some("Unexpected end of JSON input")),
        (
            "{\"a\":\"\\u12\"}",
            Some("Bad Unicode escape in JSON at position 10 (line 1 column 11)"),
        ),
        (
            "[01]",
            Some("Unexpected number in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "[-]",
            Some("No number after minus sign in JSON at position 2 (line 1 column 3)"),
        ),
        (
            "{\"k\":1.}",
            Some("Unterminated fractional number in JSON at position 7 (line 1 column 8)"),
        ),
        (
            "[1e]",
            Some("Exponent part is missing a number in JSON at position 3 (line 1 column 4)"),
        ),
        (
            "{'a':1}",
            Some("Expected property name or '}' in JSON at position 1 (line 1 column 2)"),
        ),
        (
            "[1,2,3]x",
            Some("Unexpected non-whitespace character after JSON at position 7 (line 1 column 8)"),
        ),
        (
            "\"unterminated\u{a}string",
            Some(
                "Bad control character in string literal in JSON at position 13 (line 1 column 14)",
            ),
        ),
    ];

    #[test]
    fn the_message_is_what_node_throws() {
        for (text, expected) in NODE_MESSAGES {
            assert_eq!(
                json_parse_error_message(text).as_deref(),
                *expected,
                "text {text:?}"
            );
        }
    }
}
