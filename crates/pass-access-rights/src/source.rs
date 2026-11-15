//! Value sources in their IR form (ADR 0002 section 4, ADR 0004 section 13).

use seampact_diagnostics::InternalError;
use seampact_ir::{ValueSource, ValueSourceIn};

pub(crate) const NAMED_SOURCES: &[&str] =
    &["path", "query", "header", "body", "principal", "scope"];

pub(crate) const BARE_SOURCES: &[&str] = &["host", "subdomain", "address", "resolver"];

pub(crate) fn is_named_source(text: &str) -> bool {
    NAMED_SOURCES.contains(&text)
}

pub(crate) fn is_bare_source(text: &str) -> bool {
    BARE_SOURCES.contains(&text)
}

/// The IR form of a value source text, `None` for a text outside the grammar's forms. An address
/// prefix (`address/64`) keeps its bits as written; the caller checks their range.
///
/// # Errors
///
/// An internal error for an address prefix whose digits do not fit an integer.
pub(crate) fn access_rights_value_source(text: &str) -> Result<Option<ValueSource>, InternalError> {
    if is_bare_source(text) {
        return Ok(Some(ValueSource {
            r#in: known_source(text)?,
            name: None,
            prefix_bits: None,
        }));
    }

    if let Some(digits) = address_prefix_bits_of(text) {
        let prefix_bits = digits.parse::<i64>().map_err(|error| {
            InternalError::new(format!(
                "the address prefix '{text}' does not fit an integer: {error}"
            ))
        })?;

        return Ok(Some(ValueSource {
            r#in: ValueSourceIn::Address,
            name: None,
            prefix_bits: Some(prefix_bits),
        }));
    }

    let Some((kind, name)) = text.split_once('.') else {
        return Ok(None);
    };

    if !is_named_source(kind) {
        return Ok(None);
    }

    Ok(Some(ValueSource {
        r#in: known_source(kind)?,
        name: Some(name.to_owned()),
        prefix_bits: None,
    }))
}

fn known_source(text: &str) -> Result<ValueSourceIn, InternalError> {
    ValueSourceIn::known(text).ok_or_else(|| {
        InternalError::new(format!("'{text}' is a value source the IR does not know"))
    })
}

/// The text of an IR value source, as a contract writes it.
pub(crate) fn access_rights_source_text(source: &ValueSource) -> String {
    if let Some(prefix_bits) = source.prefix_bits {
        return format!("{}/{prefix_bits}", source.r#in);
    }

    match &source.name {
        Some(name) => format!("{}.{name}", source.r#in),
        None => source.r#in.to_string(),
    }
}

/// The digits of `address/<digits>`, the key source of an address prefix.
fn address_prefix_bits_of(text: &str) -> Option<&str> {
    let digits = text.strip_prefix("address/")?;

    (!digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())).then_some(digits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_text_reads_each_form_and_refuses_the_rest() {
        let named = access_rights_value_source("body.owner.id")
            .unwrap()
            .unwrap();

        assert_eq!(named.r#in, ValueSourceIn::Body);
        assert_eq!(named.name.as_deref(), Some("owner.id"));
        assert_eq!(
            access_rights_value_source("host").unwrap().unwrap().r#in,
            ValueSourceIn::Host
        );

        for refused in [
            "",
            "body",
            "holderField.x",
            "address/",
            "address/6x",
            "path",
        ] {
            assert_eq!(
                access_rights_value_source(refused).unwrap(),
                None,
                "text {refused:?}"
            );
        }
    }

    #[test]
    fn an_address_prefix_keeps_its_digits_as_a_number() {
        let source = access_rights_value_source("address/064").unwrap().unwrap();

        assert_eq!(source.prefix_bits, Some(64));
        assert_eq!(access_rights_source_text(&source), "address/64");
        assert!(access_rights_value_source("address/99999999999999999999").is_err());
    }

    #[test]
    fn the_source_text_round_trips() {
        for text in ["header.X-Key", "scope.tenant", "address", "address/48"] {
            let source = access_rights_value_source(text).unwrap().unwrap();

            assert_eq!(access_rights_source_text(&source), text);
        }
    }
}
