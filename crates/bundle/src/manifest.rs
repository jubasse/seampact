//! The manifest of a bundle, `seampact-bundle.json`.

use std::ops::RangeInclusive;

use seampact_diagnostics::InternalError;
use seampact_json::{JsonNumber, JsonObject, JsonValue, js_integer_in_range};

/// The format version this crate writes and reads; a reader refuses another.
pub const BUNDLE_FORMAT_VERSION: i64 = 1;

/// The manifest's file name, at the bundle root.
pub const BUNDLE_MANIFEST_FILE: &str = "seampact-bundle.json";

/// The directory of the sources as authored, and of the vendored packs below it.
pub const BUNDLE_SOURCES_DIRECTORY: &str = "sources";

/// The directory of the canonical IR of each api, `ir/<api>.json`.
pub const BUNDLE_IR_DIRECTORY: &str = "ir";

/// A name and a version: the contract, the compiler or a pack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleNamedVersion {
    /// The `name` member.
    pub name: String,
    /// The `version` member.
    pub version: String,
}

/// An api of the bundle and the IR file that holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleApi {
    /// The `name` member.
    pub name: String,
    /// `ir/<name>.json`.
    pub file: String,
    /// The `irVersion` member.
    pub ir_version: i64,
    /// The `irRevision` member.
    pub ir_revision: i64,
}

/// A file the manifest lists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleFile {
    /// A portable path.
    pub path: String,
    /// The size in bytes.
    pub size: u64,
    /// Lowercase hexadecimal.
    pub sha256: String,
}

/// The manifest of a bundle, `seampact-bundle.json`; its format version is always
/// [`BUNDLE_FORMAT_VERSION`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleManifest {
    /// The contract package the bundle was made from.
    pub contract: BundleNamedVersion,
    /// Each api of the workspace.
    pub apis: Vec<BundleApi>,
    /// The compiler that wrote the IR.
    pub compiler: BundleNamedVersion,
    /// The packs the apis apply, sorted by name then version.
    pub packs: Vec<BundleNamedVersion>,
    /// Every file but the manifest, sorted by path in code-unit order.
    pub files: Vec<BundleFile>,
    /// `sha256-` and the padded standard base64 of the SHA-256 of the canonical file list.
    pub integrity: String,
}

fn text(value: &str) -> JsonValue {
    JsonValue::String(value.to_owned())
}

fn integer(digits: &str) -> JsonValue {
    JsonNumber::from_json_text(digits).map_or(JsonValue::Null, JsonValue::Number)
}

fn members(entries: Vec<(&str, JsonValue)>) -> JsonValue {
    let mut object = JsonObject::new();

    for (key, value) in entries {
        object.insert(key.to_owned(), value);
    }

    JsonValue::Object(object)
}

impl BundleNamedVersion {
    fn to_json_value(&self) -> JsonValue {
        members(vec![
            ("name", text(&self.name)),
            ("version", text(&self.version)),
        ])
    }
}

impl BundleManifest {
    /// The manifest as the JSON document it is written as, members in the TypeScript's order.
    #[must_use]
    pub fn to_json_value(&self) -> JsonValue {
        let apis = self.apis.iter().map(|api| {
            members(vec![
                ("name", text(&api.name)),
                ("file", text(&api.file)),
                ("irVersion", integer(&api.ir_version.to_string())),
                ("irRevision", integer(&api.ir_revision.to_string())),
            ])
        });
        let files = self.files.iter().map(|file| {
            members(vec![
                ("path", text(&file.path)),
                ("size", integer(&file.size.to_string())),
                ("sha256", text(&file.sha256)),
            ])
        });

        members(vec![
            ("formatVersion", integer(&BUNDLE_FORMAT_VERSION.to_string())),
            ("contract", self.contract.to_json_value()),
            ("apis", JsonValue::Array(apis.collect())),
            ("compiler", self.compiler.to_json_value()),
            (
                "packs",
                JsonValue::Array(
                    self.packs
                        .iter()
                        .map(BundleNamedVersion::to_json_value)
                        .collect(),
                ),
            ),
            ("files", JsonValue::Array(files.collect())),
            ("integrity", text(&self.integrity)),
        ])
    }

    /// The manifest a document that passed the manifest schema holds.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the document lacks a member the schema requires.
    pub fn from_json_value(document: &JsonValue) -> Result<Self, InternalError> {
        let root = object_of(document, "the manifest")?;

        Ok(Self {
            contract: named_version(member(root, "contract")?)?,
            apis: list(root, "apis")?
                .iter()
                .map(api_of)
                .collect::<Result<_, _>>()?,
            compiler: named_version(member(root, "compiler")?)?,
            packs: list(root, "packs")?
                .iter()
                .map(named_version)
                .collect::<Result<_, _>>()?,
            files: list(root, "files")?
                .iter()
                .map(file_of)
                .collect::<Result<_, _>>()?,
            integrity: string(root, "integrity")?,
        })
    }
}

fn shape_error(what: &str) -> InternalError {
    InternalError::new(format!(
        "bundle: {what} passed the manifest schema but has the wrong shape"
    ))
}

fn object_of<'tree>(
    value: &'tree JsonValue,
    what: &str,
) -> Result<&'tree JsonObject, InternalError> {
    match value {
        JsonValue::Object(object) => Ok(object),
        JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::Number(_)
        | JsonValue::String(_)
        | JsonValue::Array(_) => Err(shape_error(what)),
    }
}

fn member<'tree>(object: &'tree JsonObject, key: &str) -> Result<&'tree JsonValue, InternalError> {
    object
        .get(key)
        .ok_or_else(|| shape_error(&format!("the member '{key}'")))
}

fn list<'tree>(object: &'tree JsonObject, key: &str) -> Result<&'tree [JsonValue], InternalError> {
    match member(object, key)? {
        JsonValue::Array(items) => Ok(items),
        JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::Number(_)
        | JsonValue::String(_)
        | JsonValue::Object(_) => Err(shape_error(&format!("the member '{key}'"))),
    }
}

fn string(object: &JsonObject, key: &str) -> Result<String, InternalError> {
    match member(object, key)? {
        JsonValue::String(text) => Ok(text.clone()),
        JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::Number(_)
        | JsonValue::Array(_)
        | JsonValue::Object(_) => Err(shape_error(&format!("the member '{key}'"))),
    }
}

fn integer_member(
    object: &JsonObject,
    key: &str,
    allowed: RangeInclusive<i64>,
) -> Result<i64, InternalError> {
    match member(object, key)? {
        JsonValue::Number(number) => js_integer_in_range(number, allowed)
            .map_err(|error| shape_error(&format!("the member '{key}' ({error})"))),
        JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::String(_)
        | JsonValue::Array(_)
        | JsonValue::Object(_) => Err(shape_error(&format!("the member '{key}'"))),
    }
}

fn named_version(value: &JsonValue) -> Result<BundleNamedVersion, InternalError> {
    let object = object_of(value, "a name and version")?;

    Ok(BundleNamedVersion {
        name: string(object, "name")?,
        version: string(object, "version")?,
    })
}

fn api_of(value: &JsonValue) -> Result<BundleApi, InternalError> {
    let object = object_of(value, "an api")?;

    Ok(BundleApi {
        name: string(object, "name")?,
        file: string(object, "file")?,
        ir_version: integer_member(object, "irVersion", 1..=i64::MAX)?,
        ir_revision: integer_member(object, "irRevision", 0..=i64::MAX)?,
    })
}

fn file_of(value: &JsonValue) -> Result<BundleFile, InternalError> {
    let object = object_of(value, "a file")?;
    let size = u64::try_from(integer_member(object, "size", 0..=i64::MAX)?)
        .map_err(|_| shape_error("the member 'size'"))?;

    Ok(BundleFile {
        path: string(object, "path")?,
        size,
        sha256: string(object, "sha256")?,
    })
}
