//! The process environment as the TypeScript reads `process.env`: text names to text values.

use std::collections::HashMap;
use std::env;

/// The variables a fetch reads, looked up by name and never iterated into output.
pub type Environment = HashMap<String, String>;

/// The environment of this process; a value that is not UTF-8 is read lossily, as Node reads it.
#[must_use]
pub fn process_environment() -> Environment {
    env::vars_os()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            )
        })
        .collect()
}
