//! The enums catalogue: values in written order, their source or local reason, code names and
//! fallback. An enum taking another's values (`source.enum`) holds them as its own.

use indexmap::IndexMap;
use seampact_ir::{Enum, EnumSource, Name};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::raw::{TreeSchemasReporter, tree_schemas_entries};

/// The values of an enum: its own, or the cycle its `source.enum` chain closes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EnumValues {
    Values(Vec<String>),
    Cycle(Vec<String>),
}

/// A code name written beside the enum's values, with the pointer it is written at.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WrittenCodeName<'raw> {
    pub(crate) name: &'raw JsonValue,
    pub(crate) pointer: String,
}

/// Where the code names of one enum are read.
#[derive(Debug, Clone, Copy)]
struct CodeNamesSite<'raw, 'site> {
    enums: Option<&'raw JsonValue>,
    id: &'site str,
    pointer: &'site str,
}

fn strings(value: Option<&JsonValue>) -> Vec<String> {
    let Some(JsonValue::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| match item {
            JsonValue::String(text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

/// The values of the enum `name`, following `source.enum` through `path`; `None` when it has none.
pub(crate) fn tree_schemas_enum_values(
    enums: Option<&JsonValue>,
    name: &str,
    path: &[String],
) -> Result<Option<EnumValues>, PassError> {
    Err(not_ported_yet("treeSchemasEnumValues"))
}

pub(crate) fn tree_schemas_report_enum_without_values(
    reporter: &mut TreeSchemasReporter<'_, '_>,
    name: &str,
    found: Option<&EnumValues>,
    pointer: &str,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeSchemasReportEnumWithoutValues"))
}

pub(crate) fn tree_schemas_compile_enums(
    enums: Option<&JsonValue>,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Vec<Enum>, PassError> {
    let mut compiled = Vec::new();

    for (id, declared) in tree_schemas_entries(enums) {
        if let Some(declared_enum) = compile_enum(enums, id, declared, reporter)? {
            compiled.push(declared_enum);
        }
    }

    Ok(compiled)
}

fn compile_enum(
    enums: Option<&JsonValue>,
    id: &str,
    declared: &JsonValue,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<Enum>, PassError> {
    Err(not_ported_yet("compileEnum"))
}

fn source_of(declared: &JsonValue) -> Result<Option<EnumSource>, PassError> {
    Err(not_ported_yet("sourceOf"))
}

fn values_of(
    enums: Option<&JsonValue>,
    id: &str,
    declared: &JsonValue,
    pointer: &str,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<Vec<String>>, PassError> {
    Err(not_ported_yet("valuesOf"))
}

fn unique_values(
    values: Vec<String>,
    pointer: &str,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<Vec<String>>, PassError> {
    Err(not_ported_yet("uniqueValues"))
}

fn check_fallback(
    values: &[String],
    fallback: Option<&JsonValue>,
    pointer: &str,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkFallback"))
}

fn written_code_names<'raw>(
    enums: Option<&'raw JsonValue>,
    id: &str,
    seen: &[String],
) -> Result<IndexMap<String, WrittenCodeName<'raw>>, PassError> {
    Err(not_ported_yet("writtenCodeNames"))
}

fn code_names_of(
    values: &[String],
    site: CodeNamesSite<'_, '_>,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<IndexMap<String, Name>>, PassError> {
    Err(not_ported_yet("codeNamesOf"))
}
