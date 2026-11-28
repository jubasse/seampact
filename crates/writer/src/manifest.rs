//! The manifest of an output directory, version 2: its owner and each file with its hashes.

use std::collections::HashSet;

use camino::Utf8Path;
use seampact_js::cmp_utf16;
use seampact_json::{JsonNumber, JsonObject, JsonValue, indented_json, js_text_of};
use seampact_paths::RelativeOutputPath;

use crate::WriterError;
use crate::file_presence::{CappedRead, read_regular_file_capped};
use crate::generated_paths::MANIFEST_FILE_NAME;

/// The version the writer writes and reads besides the 1.x manifest, which has none.
const MANIFEST_VERSION: i64 = 2;

/// The largest manifest read, the loader's file size limit (4 MiB).
const MANIFEST_MAX_BYTES: u64 = 4 * 1024 * 1024;

/// One file of a manifest.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ManifestEntry {
    /// The path, relative to the output directory.
    pub path: String,
    /// The SHA-256 of the bytes before the user's formatter ran; `sha256` without one.
    pub source: String,
    /// The SHA-256 of the bytes written.
    pub sha256: String,
    /// The user's formatter, when the entry has one.
    pub formatter: Option<String>,
}

/// The manifest of a directory as read: its owner and entries, or why it is refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestRead {
    /// The manifest, empty and without an owner when the directory has none.
    Read {
        /// The entry id or `openapi` that wrote the directory.
        owner: Option<String>,
        /// The files, in the order the manifest lists them.
        entries: Vec<ManifestEntry>,
    },
    /// The manifest cannot be read; the reason completes "the manifest is invalid: ".
    Invalid {
        /// Why.
        reason: String,
    },
}

/// Reads the manifest of `root_directory`; a missing one is an empty manifest without an owner.
///
/// Every entry is checked like a generated path, so a tampered manifest cannot make the writer
/// delete outside its directory. A manifest without `version` is a 1.x one: its `source` is its
/// `sha256`.
///
/// # Errors
///
/// [`WriterError::Io`] when the manifest exists and cannot be read. A link, a directory or a file
/// above 4 MiB is [`ManifestRead::Invalid`], never followed or read whole.
pub fn read_manifest(root_directory: &Utf8Path) -> Result<ManifestRead, WriterError> {
    let manifest_path = root_directory.join(MANIFEST_FILE_NAME);
    let text = match read_regular_file_capped(&manifest_path, MANIFEST_MAX_BYTES)? {
        None => {
            return Ok(ManifestRead::Read {
                owner: None,
                entries: Vec::new(),
            });
        }
        Some(CappedRead::Text(text)) => text,
        Some(CappedRead::NotRegularFile) => {
            return Ok(invalid("it is not a regular file".to_owned()));
        }
        Some(CappedRead::TooLarge) => {
            return Ok(invalid(format!(
                "it is larger than {MANIFEST_MAX_BYTES} bytes"
            )));
        }
    };

    Ok(match serde_json::from_str::<JsonValue>(&text) {
        Ok(parsed) => entries_of(&parsed),
        Err(error) => invalid(format!("it is not JSON ({error})")),
    })
}

/// The manifest text of `owner` and its entries, version 2, written with `indented_json`; the
/// entries go in UTF-16 order of path and `formatter` is left out of an entry without one.
#[must_use]
pub fn serialize_manifest(owner: &str, entries: &[ManifestEntry]) -> String {
    let mut sorted: Vec<&ManifestEntry> = entries.iter().collect();

    sorted.sort_by(|left, right| cmp_utf16(&left.path, &right.path));

    let files: Vec<JsonValue> = sorted.into_iter().map(entry_value).collect();
    let manifest = JsonValue::object([
        (
            "version",
            JsonValue::Number(JsonNumber::from_i64(MANIFEST_VERSION)),
        ),
        ("owner", JsonValue::text(owner)),
        ("files", JsonValue::Array(files)),
    ]);

    indented_json(&manifest)
}

fn entry_value(entry: &ManifestEntry) -> JsonValue {
    let mut value = JsonObject::from_members([
        ("path", JsonValue::text(&entry.path)),
        ("source", JsonValue::text(&entry.source)),
        ("sha256", JsonValue::text(&entry.sha256)),
    ]);

    if let Some(formatter) = &entry.formatter {
        value.insert("formatter".to_owned(), JsonValue::text(formatter));
    }

    JsonValue::Object(value)
}

fn invalid(reason: String) -> ManifestRead {
    ManifestRead::Invalid { reason }
}

/// Which manifest layout the entries follow.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ManifestLayout {
    /// No `version`: `{ path, sha256 }`.
    Legacy,
    /// `"version": 2`: `{ path, source, sha256, formatter? }`.
    Current,
}

fn layout_of(parsed: &JsonObject) -> Result<ManifestLayout, String> {
    let Some(version) = parsed.get("version") else {
        return Ok(ManifestLayout::Legacy);
    };

    match version {
        JsonValue::Number(_) if js_text_of(Some(version)) == MANIFEST_VERSION.to_string() => {
            Ok(ManifestLayout::Current)
        }
        _ => Err(format!(
            "it is version {}, which this seampact does not read",
            js_text_of(Some(version))
        )),
    }
}

fn entries_of(parsed: &JsonValue) -> ManifestRead {
    let JsonValue::Object(object) = parsed else {
        return invalid("it has no `files` array".to_owned());
    };

    let layout = match layout_of(object) {
        Ok(layout) => layout,
        Err(reason) => return invalid(reason),
    };

    let Some(JsonValue::Array(files)) = object.get("files") else {
        return invalid("it has no `files` array".to_owned());
    };

    let Some(JsonValue::String(owner)) = object.get("owner") else {
        return invalid("it has no `owner` target id".to_owned());
    };

    let mut entries: Vec<ManifestEntry> = Vec::with_capacity(files.len());
    let mut seen: HashSet<String> = HashSet::new();

    for file in files {
        let entry = match entry_of(file, layout, &seen) {
            Ok(entry) => entry,
            Err(reason) => return invalid(reason),
        };

        seen.insert(entry.path.clone());
        entries.push(entry);
    }

    ManifestRead::Read {
        owner: Some(owner.clone()),
        entries,
    }
}

/// The entry, or why the manifest is invalid because of it.
fn entry_of(
    file: &JsonValue,
    layout: ManifestLayout,
    seen: &HashSet<String>,
) -> Result<ManifestEntry, String> {
    let entry = entry_with_shape(file, layout)?;

    if !is_sha256_hex(&entry.sha256) || !is_sha256_hex(&entry.source) {
        return Err(format!(
            "the hash of '{}' is not a SHA-256 hex digest",
            entry.path
        ));
    }

    if seen.contains(&entry.path) {
        return Err(format!("'{}' is listed twice", entry.path));
    }

    if let Err(unsafe_path) = RelativeOutputPath::try_new(entry.path.as_str()) {
        return Err(format!(
            "the path '{}' is unsafe: {}",
            entry.path,
            unsafe_path.reason()
        ));
    }

    Ok(entry)
}

fn entry_with_shape(file: &JsonValue, layout: ManifestLayout) -> Result<ManifestEntry, String> {
    let shape_problem = match layout {
        ManifestLayout::Legacy => "an entry is not `{ path, sha256 }` strings",
        ManifestLayout::Current => {
            "an entry is not `{ path, source, sha256 }` strings with an optional `formatter` string"
        }
    };

    let JsonValue::Object(object) = file else {
        return Err(shape_problem.to_owned());
    };
    let (Some(path), Some(sha256)) = (object.text_member("path"), object.text_member("sha256"))
    else {
        return Err(shape_problem.to_owned());
    };

    let source = match (layout, object.get("source")) {
        (ManifestLayout::Legacy, _) => sha256,
        (ManifestLayout::Current, Some(JsonValue::String(source))) => source,
        (ManifestLayout::Current, _) => return Err(shape_problem.to_owned()),
    };

    let formatter = match (layout, object.get("formatter")) {
        (ManifestLayout::Legacy, _) | (ManifestLayout::Current, None) => None,
        (ManifestLayout::Current, Some(JsonValue::String(formatter))) => Some(formatter.clone()),
        (ManifestLayout::Current, Some(_)) => return Err(shape_problem.to_owned()),
    };

    Ok(ManifestEntry {
        path: path.to_owned(),
        source: source.to_owned(),
        sha256: sha256.to_owned(),
        formatter,
    })
}

/// `/^[0-9a-f]{64}$/`.
fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
