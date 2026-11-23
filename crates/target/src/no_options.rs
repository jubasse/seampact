//! The options of a target that takes none yet.

use seampact_json::{JsonValue, escape_pointer};

use crate::Refusal;

/// The options of a target that takes none: naming and style options wait.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct NoOptions;

/// Accepts `{}` only, or no options (the run planning passes `{}` for an entry that writes none);
/// each key is refused by name.
///
/// # Errors
///
/// `options.invalid` when the options are no object, one `options.unknown` per key.
pub fn parse_no_options(raw: Option<&JsonValue>) -> Result<NoOptions, Vec<Refusal>> {
    let Some(raw) = raw else {
        return Ok(NoOptions);
    };
    let JsonValue::Object(object) = raw else {
        return Err(vec![Refusal {
            code: "options.invalid".to_owned(),
            message: format!(
                "The target options are {}, not an object.",
                described_value(raw)
            ),
            fix: "Write the target's `options` as an object, or leave it out.".to_owned(),
            operation: None,
            member: Some(String::new()),
            docs: None,
        }]);
    };

    if object.is_empty() {
        return Ok(NoOptions);
    }

    Err(object
        .keys()
        .map(|key| refuse_unknown_option(key))
        .collect())
}

fn refuse_unknown_option(key: &str) -> Refusal {
    Refusal {
        code: "options.unknown".to_owned(),
        message: format!(
            "The option '{key}' is not one this target knows; it takes no option yet."
        ),
        fix: format!("Remove '{key}' from the target's `options`."),
        operation: None,
        member: Some(format!("/{}", escape_pointer(key))),
        docs: None,
    }
}

fn described_value(raw: &JsonValue) -> &'static str {
    match raw {
        JsonValue::Null => "null",
        JsonValue::Array(_) => "an array",
        JsonValue::Bool(_) => "a boolean",
        JsonValue::Number(_) => "a number",
        JsonValue::String(_) => "a string",
        JsonValue::Object(_) => "an object",
    }
}
