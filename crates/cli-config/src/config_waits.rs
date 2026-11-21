//! The keys and values of an app config that wait for a later feature.

use seampact_json::{JsonObject, JsonValue};

use crate::config_position::ParsedConfig;
use crate::json_access::record;
use crate::key_path::{KeyPath, KeyPathSegment};
use crate::key_problem::KeyProblem;
use crate::{CliConfigError, CliProblem};

const SERVER_ENTRY_BRINGER: &str = "the server targets, through a codegen-core seam (p5)";
const MODULE_LINK_BRINGER: &str = "links across the apps of a monorepo, once an app needs one";
const BOOT_CHECK_ARTEFACT: &str = "bootCheck";

/// The handler check of the boot check comes with the access hooks.
const BOOT_CHECK_SWITCH_WAITS: [(&str, &str); 1] = [("handlers", SERVER_ENTRY_BRINGER)];

const ENTRY_KEY_WAITS: [(&str, &str); 1] = [("access", SERVER_ENTRY_BRINGER)];

const DEFAULT_WAIT_FIX: &str = "Remove it from the config for now.";

/// A key or value form that waits for a later feature.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfigWait {
    pub(crate) path: KeyPath,
    pub(crate) what: String,
    pub(crate) bringer: String,
    pub(crate) fix: Option<String>,
}

/// Every waiting key or value form of `config`, the parsed YAML not yet checked by the schema.
pub(crate) fn find_config_waits(config: &JsonValue) -> Vec<ConfigWait> {
    let Some(JsonValue::Array(targets)) =
        record(Some(config)).and_then(|object| object.get("targets"))
    else {
        return Vec::new();
    };

    targets
        .iter()
        .enumerate()
        .flat_map(|(index, entry)| target_entry_waits(entry, index))
        .collect()
}

fn target_entry_waits(entry: &JsonValue, index: usize) -> Vec<ConfigWait> {
    let Some(object) = record(Some(entry)) else {
        return Vec::new();
    };
    let path = vec![
        KeyPathSegment::key("targets"),
        KeyPathSegment::position(index),
    ];
    let mut waits = waiting_keys_of(object, &path, &ENTRY_KEY_WAITS);

    if let Some(artefacts) = object.get("artefacts") {
        waits.extend(artefact_switch_waits(
            artefacts,
            &extended(&path, "artefacts"),
        ));
    }

    if let Some(link) = record(object.get("link")) {
        waits.extend(module_link_waits(link, &extended(&path, "link")));
    }

    waits
}

fn waiting_keys_of(
    value: &JsonObject,
    path: &[KeyPathSegment],
    waits: &[(&str, &str)],
) -> Vec<ConfigWait> {
    waits
        .iter()
        .filter(|(key, _)| value.contains_key(key))
        .map(|(key, bringer)| ConfigWait {
            path: extended(path, key),
            what: format!("the key '{key}'"),
            bringer: (*bringer).to_owned(),
            fix: None,
        })
        .collect()
}

fn artefact_switch_waits(artefacts: &JsonValue, path: &[KeyPathSegment]) -> Vec<ConfigWait> {
    let Some(boot_check) =
        record(record(Some(artefacts)).and_then(|object| object.get(BOOT_CHECK_ARTEFACT)))
    else {
        return Vec::new();
    };
    let boot_check_path = extended(path, BOOT_CHECK_ARTEFACT);

    BOOT_CHECK_SWITCH_WAITS
        .iter()
        .filter(|(key, _)| boot_check.contains_key(key))
        .map(|(key, bringer)| ConfigWait {
            path: extended(&boot_check_path, key),
            what: format!("the boot check switch '{key}'"),
            bringer: (*bringer).to_owned(),
            fix: None,
        })
        .collect()
}

fn module_link_waits(link: &JsonObject, path: &[KeyPathSegment]) -> Vec<ConfigWait> {
    link.iter()
        .filter(|(_, value)| record(Some(value)).is_some())
        .map(|(kind, _)| ConfigWait {
            path: extended(path, kind),
            what: "a link with an explicit module specifier".to_owned(),
            bringer: MODULE_LINK_BRINGER.to_owned(),
            fix: None,
        })
        .collect()
}

fn extended(path: &[KeyPathSegment], key: &str) -> KeyPath {
    let mut longer = path.to_vec();

    longer.push(KeyPathSegment::key(key));

    longer
}

/// The `config.key.waits` problem of each wait.
pub(crate) fn wait_problems(
    parsed: &ParsedConfig,
    waits: Vec<ConfigWait>,
) -> Result<Vec<KeyProblem>, CliConfigError> {
    waits
        .into_iter()
        .map(|wait| {
            let location = parsed.where_of(&wait.path)?;
            let message = format!(
                "{} is not available yet; it comes with {}.",
                capitalized(&wait.what),
                wait.bringer
            );
            let fix = wait.fix.as_deref().unwrap_or(DEFAULT_WAIT_FIX);

            Ok(KeyProblem {
                path: wait.path,
                problem: CliProblem::at("config.key.waits", message, fix, location),
            })
        })
        .collect()
}

/// The text with its first UTF-16 unit upper-cased: a character outside the BMP stays as it is.
fn capitalized(text: &str) -> String {
    let mut characters = text.chars();

    match characters.next() {
        Some(first) if first.len_utf16() == 1 => {
            format!("{}{}", first.to_uppercase(), characters.as_str())
        }
        Some(first) => format!("{first}{}", characters.as_str()),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capitalizing_expands_sharp_s_and_leaves_an_astral_first_character() {
        assert_eq!(capitalized("stra\u{df}e"), "Stra\u{df}e");
        assert_eq!(capitalized("\u{df}x"), "SSx");
        assert_eq!(capitalized("\u{10428}x"), "\u{10428}x");
        assert_eq!(capitalized(""), "");
    }
}
