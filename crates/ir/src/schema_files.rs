//! The IR JSON Schema files, embedded from `packages/core/spec/schemas/ir`.

/// One IR JSON Schema file: its file name and text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IrSchemaFile {
    /// The file name, as `$ref` values name it (`common.schema.json`).
    pub name: &'static str,
    /// The file text.
    pub text: &'static str,
}

/// Embeds the IR schema file `name`.
macro_rules! ir_schema_file {
    ($name:literal) => {
        IrSchemaFile {
            name: $name,
            text: include_str!(concat!("../../../packages/core/spec/schemas/ir/", $name)),
        }
    };
}

/// Every IR JSON Schema file; `ir.schema.json` is the root of the IR document,
/// `source-map.schema.json` the root of the source map.
pub const IR_SCHEMA_FILES: &[IrSchemaFile] = &[
    ir_schema_file!("common.schema.json"),
    ir_schema_file!("declarations.schema.json"),
    ir_schema_file!("formats.schema.json"),
    ir_schema_file!("ir.schema.json"),
    ir_schema_file!("operation.schema.json"),
    ir_schema_file!("schemas.schema.json"),
    ir_schema_file!("source-map.schema.json"),
];
