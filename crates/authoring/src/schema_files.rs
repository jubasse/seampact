//! The authoring JSON Schema files, embedded from `packages/core/spec/schemas/authoring`.
//!
//! The TypeScript builders of `packages/core/spec/src/authoring` stay the source of these files.

/// One authoring JSON Schema file: its kind, its file name and its text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthoringSchemaFile {
    /// The file kind, the file name without `.schema.json` (`node-errors`).
    pub file: &'static str,
    /// The file name, as `$ref` values name it (`node-errors.schema.json`).
    pub name: &'static str,
    /// The file text.
    pub text: &'static str,
}

/// Embeds the authoring schema file of kind `file`.
macro_rules! authoring_schema_file {
    ($file:literal) => {
        AuthoringSchemaFile {
            file: $file,
            name: concat!($file, ".schema.json"),
            text: include_str!(concat!(
                "../../../packages/core/spec/schemas/authoring/",
                $file,
                ".schema.json"
            )),
        }
    };
}

/// Every authoring schema file (ADR 0002 section 3), in the order of the TypeScript
/// `AUTHORING_FILES`: the file kinds, the fragment kinds, the catalogues, then `common`, the
/// definitions they share.
pub const AUTHORING_SCHEMA_FILES: &[AuthoringSchemaFile] = &[
    authoring_schema_file!("workspace"),
    authoring_schema_file!("api"),
    authoring_schema_file!("base"),
    authoring_schema_file!("pack"),
    authoring_schema_file!("node"),
    authoring_schema_file!("node-errors"),
    authoring_schema_file!("conventions"),
    authoring_schema_file!("schema"),
    authoring_schema_file!("schemas"),
    authoring_schema_file!("enums"),
    authoring_schema_file!("scalars"),
    authoring_schema_file!("errors"),
    authoring_schema_file!("natures"),
    authoring_schema_file!("schemes"),
    authoring_schema_file!("headers"),
    authoring_schema_file!("identities"),
    authoring_schema_file!("rights"),
    authoring_schema_file!("rules"),
    authoring_schema_file!("requirements"),
    authoring_schema_file!("scopes"),
    authoring_schema_file!("buckets"),
    authoring_schema_file!("services"),
    authoring_schema_file!("pagings"),
    authoring_schema_file!("formats"),
    authoring_schema_file!("common"),
];
