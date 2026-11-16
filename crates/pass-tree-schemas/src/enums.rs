//! The enums catalogue: values in written order, their source or local reason, code names and
//! fallback. An enum taking another's values (`source.enum`) holds them as its own.

use std::collections::HashMap;

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{
    CatalogueEnumSource, Docs, Enum, EnumId, EnumSource, IrMap, Name, NameRole, Reason,
    VocabularyEnumSource,
};
use seampact_json::JsonValue;
use seampact_naming::{NameSource, SegmentsOptions, SegmentsResult, segments_of, split_name};
use seampact_pipeline::PassError;

use crate::raw::{
    TreeSchemasProblem, TreeSchemasReporter, tree_schemas_entries, tree_schemas_member,
    tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;

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
) -> Option<EnumValues> {
    if let Some(at) = path.iter().position(|followed| followed == name) {
        let mut cycle: Vec<String> = path.iter().skip(at).cloned().collect();

        cycle.push(name.to_owned());

        return Some(EnumValues::Cycle(cycle));
    }

    let declared = tree_schemas_member(enums, name);
    let values = tree_schemas_member(declared, "values");

    if let Some(JsonValue::Array(_)) = values {
        return Some(EnumValues::Values(strings(values)));
    }

    let source = tree_schemas_member(tree_schemas_member(declared, "source"), "enum");

    match source {
        Some(JsonValue::String(other)) => {
            let mut followed = path.to_vec();

            followed.push(name.to_owned());

            tree_schemas_enum_values(enums, other, &followed)
        }
        _ => None,
    }
}

/// Reports why an enum named at `pointer` has no values: it is unknown, or its sources form a cycle.
pub(crate) fn tree_schemas_report_enum_without_values(
    reporter: &mut TreeSchemasReporter<'_, '_>,
    name: &str,
    found: Option<&EnumValues>,
    pointer: &str,
) -> Result<(), PassError> {
    let Some(EnumValues::Cycle(cycle)) = found else {
        return reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::EnumUnknown,
            pointer: pointer.to_owned(),
            message: format!("no enum '{name}' with values is declared"),
            fix: "declare it under 'enums', or fix the name".to_owned(),
            related: None,
        });
    };

    reporter.error(TreeSchemasProblem {
        rule: TreeSchemasRule::EnumCycle,
        pointer: pointer.to_owned(),
        message: format!(
            "the enum '{name}' takes its values from a cycle of sources: {}",
            cycle.join(" -> ")
        ),
        fix: "give one enum of the cycle its own 'values'".to_owned(),
        related: None,
    })
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
    let pointer = tree_schemas_pointer("/enums", &[id]);
    let values = values_of(enums, id, declared, &pointer, reporter)?;
    let source = source_of(declared);
    let reason = tree_schemas_member(Some(declared), "reason");
    let fallback = tree_schemas_member(Some(declared), "fallback");

    let Some(values) = values else {
        return Ok(None);
    };
    let mut failed = !check_fallback(&values, fallback, &pointer, reporter)?;

    if let (Some(JsonValue::String(_)), Some(_)) = (reason, &source) {
        failed = true;
        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::EnumReason,
            pointer: tree_schemas_pointer(&pointer, &["reason"]),
            message: format!(
                "the enum '{id}' has a source, and a reason says why an enum is local"
            ),
            fix: "remove 'reason', or remove the source of a local enum".to_owned(),
            related: None,
        })?;
    }

    let code_names = code_names_of(
        &values,
        CodeNamesSite {
            enums,
            id,
            pointer: &pointer,
        },
        reporter,
    )?;

    let Some(code_names) = code_names else {
        return Ok(None);
    };

    if failed {
        return Ok(None);
    }

    let summary = tree_schemas_member(Some(declared), "summary");
    let description = tree_schemas_member(Some(declared), "description");
    let code_names = (!code_names.is_empty()).then(|| {
        let mut map = IrMap::new();

        for (value, name) in code_names {
            map.insert(value, name);
        }

        map
    });

    Ok(Some(Enum {
        id: EnumId::new(id.to_owned()),
        name: Name {
            segments: split_name(id),
            role: NameRole::Schema,
            status: None,
        },
        values,
        code_names,
        source,
        local_reason: match reason {
            Some(JsonValue::String(text)) => Some(Reason::new(text.clone())),
            _ => None,
        },
        fallback: match fallback {
            Some(JsonValue::String(text)) => Some(text.clone()),
            _ => None,
        },
        directions: Vec::new(),
        docs: Docs {
            summary: written_text(summary),
            description: written_text(description),
        },
        origin: reporter.origin(&pointer)?,
    }))
}

fn written_text(value: Option<&JsonValue>) -> Option<String> {
    match value {
        Some(JsonValue::String(text)) => Some(text.clone()),
        _ => None,
    }
}

fn source_of(declared: &JsonValue) -> Option<EnumSource> {
    let source = tree_schemas_member(Some(declared), "source");
    let vocabulary = tree_schemas_member(source, "vocabulary");
    let other = tree_schemas_member(source, "enum");

    if let Some(JsonValue::String(vocabulary)) = vocabulary {
        return Some(EnumSource::Vocabulary(VocabularyEnumSource {
            vocabulary: vocabulary.clone(),
        }));
    }

    match other {
        Some(JsonValue::String(other)) => Some(EnumSource::Enum(CatalogueEnumSource {
            r#enum: EnumId::new(other.clone()),
        })),
        _ => None,
    }
}

fn values_of(
    enums: Option<&JsonValue>,
    id: &str,
    declared: &JsonValue,
    pointer: &str,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<Vec<String>>, PassError> {
    let written = tree_schemas_member(Some(declared), "values");
    let other = match tree_schemas_member(tree_schemas_member(Some(declared), "source"), "enum") {
        Some(JsonValue::String(other)) => Some(other.as_str()),
        _ => None,
    };
    let problem = match (written, other) {
        (None, None) => Some((
            format!("the enum '{id}' declares no values"),
            "write 'values', or 'source: { enum: <Enum> }'".to_owned(),
        )),
        (Some(_), Some(other)) => Some((
            format!("the enum '{id}' takes the values of '{other}' and writes values of its own"),
            "remove 'values', or the 'source.enum'".to_owned(),
        )),
        _ => None,
    };

    if let Some((message, fix)) = problem {
        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::EnumValues,
            pointer: pointer.to_owned(),
            message,
            fix,
            related: None,
        })?;

        return Ok(None);
    }

    if let Some(other) = other {
        let found = tree_schemas_enum_values(enums, id, &[]);

        if let Some(EnumValues::Values(values)) = found {
            return Ok(Some(values));
        }

        tree_schemas_report_enum_without_values(
            reporter,
            other,
            found.as_ref(),
            &tree_schemas_pointer(pointer, &["source", "enum"]),
        )?;

        return Ok(None);
    }

    unique_values(
        strings(written),
        &tree_schemas_pointer(pointer, &["values"]),
        reporter,
    )
}

fn unique_values(
    values: Vec<String>,
    pointer: &str,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<Vec<String>>, PassError> {
    let mut repeated: Vec<&str> = Vec::new();

    for (index, value) in values.iter().enumerate() {
        let first = values.iter().position(|other| other == value);

        if first != Some(index) && !repeated.contains(&value.as_str()) {
            repeated.push(value);
        }
    }

    for value in &repeated {
        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::EnumValues,
            pointer: pointer.to_owned(),
            message: format!("the value '{value}' is listed twice"),
            fix: "list each value once".to_owned(),
            related: None,
        })?;
    }

    Ok(repeated.is_empty().then_some(values))
}

fn check_fallback(
    values: &[String],
    fallback: Option<&JsonValue>,
    pointer: &str,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<bool, PassError> {
    let Some(JsonValue::String(fallback)) = fallback else {
        return Ok(true);
    };

    if values.contains(fallback) {
        return Ok(true);
    }

    reporter.error(TreeSchemasProblem {
        rule: TreeSchemasRule::EnumFallback,
        pointer: tree_schemas_pointer(pointer, &["fallback"]),
        message: format!("the fallback '{fallback}' is not a value of the enum"),
        fix: format!("name one of [{}]", values.join(", ")),
        related: None,
    })?;

    Ok(false)
}

// ADR 0007 sections 1 and 2: a code name replaces a value's segments, a value with none is named
// `value<position>`, and two values with equal segments collide. An enum taking another's values
// takes its code names too, its own winning.
fn written_code_names<'raw>(
    enums: Option<&'raw JsonValue>,
    id: &str,
    seen: &[String],
) -> IndexMap<String, WrittenCodeName<'raw>> {
    let declared = tree_schemas_member(enums, id);
    let source = tree_schemas_member(tree_schemas_member(declared, "source"), "enum");
    let mut names = match source {
        Some(JsonValue::String(other)) if !seen.contains(other) => {
            let mut followed = seen.to_vec();

            followed.push(id.to_owned());

            written_code_names(enums, other, &followed)
        }
        _ => IndexMap::new(),
    };

    for (value, name) in tree_schemas_entries(tree_schemas_member(declared, "codeNames")) {
        names.insert(
            value.to_owned(),
            WrittenCodeName {
                name,
                pointer: tree_schemas_pointer("/enums", &[id, "codeNames", value]),
            },
        );
    }

    names
}

fn code_names_of(
    values: &[String],
    site: CodeNamesSite<'_, '_>,
    reporter: &mut TreeSchemasReporter<'_, '_>,
) -> Result<Option<IndexMap<String, Name>>, PassError> {
    let CodeNamesSite { enums, id, pointer } = site;
    let written = written_code_names(enums, id, &[]);
    let values_pointer = if tree_schemas_member(tree_schemas_member(enums, id), "values").is_some()
    {
        tree_schemas_pointer(pointer, &["values"])
    } else {
        tree_schemas_pointer(pointer, &["source", "enum"])
    };
    let mut code_names: IndexMap<String, Name> = IndexMap::new();
    let mut identifiers: HashMap<String, &str> = HashMap::new();
    let mut failed = false;

    for (value, code_name) in &written {
        if values.contains(value) {
            continue;
        }

        failed = true;
        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::EnumCodeName,
            pointer: code_name.pointer.clone(),
            message: format!("'{value}' is not a value of the enum"),
            fix: "give code names to the enum's values only".to_owned(),
            related: None,
        })?;
    }

    for (index, value) in values.iter().enumerate() {
        let code_name = written.get(value);
        let name = code_name.and_then(|written_name| match written_name.name {
            JsonValue::String(text) => Some(text.as_str()),
            _ => None,
        });
        let at = code_name.map_or_else(
            || values_pointer.clone(),
            |written_name| written_name.pointer.clone(),
        );
        let options = SegmentsOptions {
            code_name: name.map(str::to_owned),
            position: Some(index + 1),
        };
        let result = segments_of(value, NameSource::EnumValue, &options)
            .map_err(|error| PassError::from(InternalError::new(error.to_string())))?;
        let SegmentsResult::Segments(segments) = result else {
            failed = true;
            reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::NameSegments,
                pointer: at,
                message: format!(
                    "the code name of the value '{value}' yields no identifier segment"
                ),
                fix: "give it a code name with at least one letter or digit".to_owned(),
                related: None,
            })?;

            continue;
        };
        let identifier = segments.join(" ");

        if name.is_some() {
            code_names.insert(
                value.clone(),
                Name {
                    segments,
                    role: NameRole::EnumMember,
                    status: None,
                },
            );
        }

        if let Some(other) = identifiers.get(&identifier) {
            failed = true;
            reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::NameCollision,
                pointer: at,
                message: format!("the values '{other}' and '{value}' give the same identifier"),
                fix: "give one of them a code name".to_owned(),
                related: None,
            })?;
        }

        identifiers.insert(identifier, value);
    }

    Ok((!failed).then_some(code_names))
}
