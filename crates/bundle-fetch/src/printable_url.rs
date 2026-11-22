//! A source URL as a diagnostic may print it: no credentials, query or fragment.

use url::Url;

const LAST_CONTROL_OR_SPACE: char = '\u{20}';

/// `text` without the user name, the password, the query and the fragment of a URL; text that is
/// no absolute URL (an scp-like git address, a path) is printed as written.
///
/// A URL that does not parse (a bad port, a bad bracket) may still hold a token, so a text that
/// starts with a scheme is redacted by text.
#[must_use]
pub fn printable_url(text: &str) -> String {
    if let Ok(url) = Url::parse(text) {
        return without_user_query_and_fragment(url);
    }

    let parser_input = as_the_url_parser_reads_it(text);

    if starts_with_scheme(&parser_input) {
        return redacted_by_text(&parser_input);
    }

    text.to_owned()
}

/// A tool's error text may repeat the URL it was given; the printable form takes its place.
#[must_use]
pub fn with_printable_url(text: &str, url: &str) -> String {
    text.replace(url, &printable_url(url))
}

fn without_user_query_and_fragment(mut url: Url) -> String {
    // The setters refuse a URL that cannot hold credentials (no host): there is nothing to drop.
    let _ = url.set_username("");
    let _ = url.set_password(None);

    url.set_query(None);
    url.set_fragment(None);

    url.into()
}

/// `^[A-Za-z][A-Za-z0-9+.-]*:`.
fn starts_with_scheme(text: &str) -> bool {
    let Some((scheme, _)) = text.split_once(':') else {
        return false;
    };
    let mut characters = scheme.chars();

    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && characters
            .all(|character| character.is_ascii_alphanumeric() || "+.-".contains(character))
}

/// Everything up to the last `@` goes first, since a password may hold a raw `?` or `#`; an `@`
/// in the query then drops more than needed, never less.
fn redacted_by_text(text: &str) -> String {
    let (scheme_and_colon, after_scheme) = match text.split_once(':') {
        Some((scheme, rest)) => (format!("{scheme}:"), rest),
        None => (String::new(), text),
    };
    let authority_and_rest = after_scheme.trim_start_matches(['/', '\\']);
    let slashes: String = after_scheme
        .chars()
        .take_while(|character| matches!(character, '/' | '\\'))
        .collect();
    let without_user = authority_and_rest
        .rsplit_once('@')
        .map_or(authority_and_rest, |(_, rest)| rest);
    let without_query = without_user.split(['?', '#']).next().unwrap_or("");

    format!("{scheme_and_colon}{slashes}{without_query}")
}

/// The WHATWG parser drops tabs and newlines anywhere and control characters and spaces at both
/// ends, so the text fallback reads the same text.
fn as_the_url_parser_reads_it(text: &str) -> String {
    let without_tabs_or_newlines: String = text
        .chars()
        .filter(|character| !matches!(character, '\t' | '\n' | '\r'))
        .collect();

    without_tabs_or_newlines
        .trim_matches(is_control_or_space)
        .to_owned()
}

fn is_control_or_space(character: char) -> bool {
    character <= LAST_CONTROL_OR_SPACE
}
