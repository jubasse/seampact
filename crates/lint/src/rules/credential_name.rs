//! A property named like a credential and not `sensitive` (ADR 0003 section 6).

use seampact_ir::KnownSchemaRef;
use seampact_naming::split_name;

use crate::lint_finding::{LintFinding, LintRuleContext};
use crate::origins::lint_owns_origin;

/// The last word of a credential name (`accessToken`, `clientSecret`); `tokenType` ends in `type`
/// and is not one.
const CREDENTIAL_WORDS: [&str; 7] = [
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "credential",
    "credentials",
];

/// The last two words (`apiKey`, `private_key`).
const CREDENTIAL_PAIRS: [&str; 2] = ["api key", "private key"];

/// How many trailing words a pair names.
const PAIR_WORDS: usize = 2;

/// Whether a property name ends in a credential word or pair, in any case style.
pub(crate) fn looks_like_credential(name: &str) -> bool {
    let words = split_name(name);
    let Some(last) = words.last() else {
        return false;
    };

    if CREDENTIAL_WORDS.contains(&last.as_str()) {
        return true;
    }

    words
        .rchunks(PAIR_WORDS)
        .next()
        .is_some_and(|tail| CREDENTIAL_PAIRS.contains(&tail.join(" ").as_str()))
}

/// The findings of the rule `seampact/credential-name`.
pub(crate) fn check(context: &LintRuleContext<'_>) -> Vec<LintFinding> {
    let mut findings = Vec::new();

    for schema in context.ir.schemas.values() {
        let Ok(KnownSchemaRef::Object(object)) = KnownSchemaRef::try_from(schema) else {
            continue;
        };

        for property in &object.properties {
            if property.sensitive || !looks_like_credential(&property.name) {
                continue;
            }

            if !lint_owns_origin(&property.origin) {
                continue;
            }

            findings.push(LintFinding {
                message: format!(
                    "The property '{}.{}' is named like a credential and is not sensitive.",
                    object.id, property.name
                ),
                fix: format!(
                    "Mark '{}.{}' sensitive, or allow seampact/credential-name on it with a reason.",
                    object.id, property.name
                ),
                origin: property.origin.clone(),
                allow_at: vec![property.origin.clone(), object.origin.clone()],
            });
        }
    }

    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_words_end_a_name_in_any_case_style() {
        for name in [
            "password",
            "accessToken",
            "client_secret",
            "ClientSecret",
            "api-key",
            "apiKey",
            "private_key",
            "PASSPHRASE",
        ] {
            assert!(looks_like_credential(name), "name {name:?}");
        }
    }

    #[test]
    fn a_credential_word_that_does_not_end_the_name_is_not_one() {
        for name in [
            "tokenType",
            "secretary",
            "keyboard",
            "key",
            "api",
            "",
            "tokens",
        ] {
            assert!(!looks_like_credential(name), "name {name:?}");
        }
    }

    #[test]
    fn a_non_ascii_name_is_read_by_its_words() {
        assert!(looks_like_credential("jeton_token"));
        assert!(!looks_like_credential("\u{1F600}"));
    }
}
