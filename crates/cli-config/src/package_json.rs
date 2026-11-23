//! A `package.json` read as `JSON.parse(readFileSync(file, "utf8"))` does.

use std::fs;

use camino::Utf8Path;
use seampact_js::json_parse_error_message;
use seampact_json::JsonValue;

use crate::CliConfigError;
use crate::config_file::io_error;

/// What reading a `package.json` gives.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum PackageJsonRead {
    /// The parsed value.
    Parsed(JsonValue),
    /// The text is not JSON; `message` is what V8's `JSON.parse` throws.
    Syntax { message: String },
}

/// Reads and parses `file`; invalid UTF-8 becomes U+FFFD, as Node's `utf8` decoding does.
///
/// # Errors
///
/// [`CliConfigError::Io`] when the file cannot be read, or holds a number JavaScript reads as
/// infinite, which no [`JsonValue`] holds.
pub(crate) fn read_package_json(file: &Utf8Path) -> Result<PackageJsonRead, CliConfigError> {
    let bytes = fs::read(file).map_err(|error| io_error(file, &error))?;
    let text = String::from_utf8_lossy(&bytes);

    if let Some(message) = json_parse_error_message(&text) {
        return Ok(PackageJsonRead::Syntax { message });
    }

    serde_json::from_str::<JsonValue>(&text)
        .map(PackageJsonRead::Parsed)
        .map_err(|error| CliConfigError::Io {
            path: file.to_string(),
            message: error.to_string(),
        })
}
