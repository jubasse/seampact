//! The OpenAPI documents of one api.

use indexmap::{IndexMap, IndexSet};
use seampact_ir::{
    ApiDocument, ContractIr, DocumentId, InternalPolicy, KnownApiVersionRef, Operation,
};
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, Refusal, without_repeats};

use crate::emit_context::{
    EmitContext, create_emit_context, refuse_unknown, write_consumer_extensions, write_extension,
};
use crate::json_value::{optional_text, set_defined, text_value};
use crate::not_ported::not_ported_yet;
use crate::security::security_schemes_component;
use crate::serialize::serialize_document;
use crate::{EmitterOptions, ExtensionName, OpenApiError};

/// The OpenAPI version every document declares.
const OPENAPI_VERSION: &str = "3.1.0";

/// One document to write: its name, and the surfaces and internal routes it keeps.
struct DocumentPlan {
    name: Option<DocumentId>,
    selection: ApiDocument,
}

/// An operation a document keeps, with its index in the IR.
struct SelectedOperation<'ir> {
    operation: &'ir Operation,
    index: usize,
}

/// A planned document with the refusals met while writing it.
struct PlannedDocument {
    document: JsonObject,
    refusals: Vec<Refusal>,
}

/// One document of an api.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedDocument {
    /// The `api.documents` key, absent for the one document of an api that declares none.
    pub name: Option<DocumentId>,
    /// The document as YAML: LF line ends, a final newline, keys in the emitter's order.
    pub text: String,
}

/// The documents of an api, or the refusals that stop them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmitOutcome {
    /// Every document of the api.
    Emitted(Vec<EmittedDocument>),
    /// Why no document is written, each naming the IR member and the fix.
    Refused(Vec<Refusal>),
}

/// The OpenAPI documents of an api, or the refusals that stop them.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a function it reaches is a stub.
pub fn emit_documents(
    ir: &ContractIr,
    options: &EmitterOptions,
) -> Result<EmitOutcome, OpenApiError> {
    let unsupported = unsupported_ir_refusals(ir)?;

    if !unsupported.is_empty() {
        return Ok(EmitOutcome::Refused(unsupported));
    }

    let mut refusals = Vec::new();
    let mut documents = Vec::new();

    for plan in document_plans(ir) {
        let built = build_planned_document(ir, options, &plan.selection)?;

        refusals.extend(built.refusals);
        documents.push(EmittedDocument {
            name: plan.name,
            text: serialize_document(&built.document)?,
        });
    }

    if !refusals.is_empty() {
        return Ok(EmitOutcome::Refused(without_repeats(refusals)));
    }

    Ok(EmitOutcome::Emitted(documents))
}

/// The documents an api declares, or the one document of every surface when it declares none.
fn document_plans(ir: &ContractIr) -> Vec<DocumentPlan> {
    if ir.api.documents.is_empty() {
        return vec![DocumentPlan {
            name: None,
            selection: every_surface_selection(ir),
        }];
    }

    ir.api
        .documents
        .iter()
        .map(|(name, selection)| DocumentPlan {
            name: Some(name.clone()),
            selection: selection.clone(),
        })
        .collect()
}

/// The selection of every surface, internal routes included.
pub(crate) fn every_surface_selection(ir: &ContractIr) -> ApiDocument {
    ApiDocument {
        surfaces: ir.api.surfaces.keys().cloned().collect(),
        internal: InternalPolicy::Include,
    }
}

/// The refusals of an IR this emitter's release does not support.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub(crate) fn unsupported_ir_refusals(_ir: &ContractIr) -> Result<Vec<Refusal>, OpenApiError> {
    Err(not_ported_yet("unsupportedIrRefusals"))
}

/// One planned document and the refusals met while writing it.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a function it reaches is a stub.
fn build_planned_document(
    ir: &ContractIr,
    options: &EmitterOptions,
    selection: &ApiDocument,
) -> Result<PlannedDocument, OpenApiError> {
    let mut context = create_emit_context(ir, options);
    let document = build_document(&mut context, selection)?;

    Ok(PlannedDocument {
        document,
        refusals: context.refusals,
    })
}

/// The operations a selection keeps, with their index in the IR.
fn selected_operations<'ir>(
    ir: &'ir ContractIr,
    selection: &ApiDocument,
) -> Vec<SelectedOperation<'ir>> {
    ir.operations
        .iter()
        .enumerate()
        .map(|(index, operation)| SelectedOperation { operation, index })
        .filter(|selected| selection.surfaces.contains(&selected.operation.surface))
        .filter(|selected| {
            !(selected.operation.internal && selection.internal == InternalPolicy::Exclude)
        })
        .collect()
}

/// One document: its info, tags, extensions, paths and components.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a function it reaches is a stub.
fn build_document(
    context: &mut EmitContext<'_>,
    selection: &ApiDocument,
) -> Result<JsonObject, OpenApiError> {
    let ir = context.ir;
    let selected = selected_operations(ir, selection);
    let formats: Vec<&str> = selected
        .iter()
        .map(|entry| entry.operation.format.as_str())
        .collect();
    let document_format = most_used_format(&formats);
    let paths = paths_object(context, &selected, document_format)?;
    let schemas = drain_schema_components(context)?;
    let security_schemes = security_schemes_component(context)?;
    let mut document = JsonObject::new();

    document.insert("openapi".to_owned(), text_value(OPENAPI_VERSION));
    document.insert("info".to_owned(), JsonValue::Object(info_object(context)?));

    if !context.options.servers.is_empty() {
        document.insert("servers".to_owned(), servers_array(context.options)?);
    }

    let mut tags: Vec<&str> = selected
        .iter()
        .flat_map(|entry| entry.operation.tags.iter().map(String::as_str))
        .collect::<IndexSet<&str>>()
        .into_iter()
        .collect();

    tags.sort_by(|left, right| cmp_utf16(left, right));

    if !tags.is_empty() {
        let named: Vec<JsonValue> = tags
            .into_iter()
            .map(|name| {
                let mut tag = JsonObject::new();

                tag.insert("name".to_owned(), text_value(name));

                JsonValue::Object(tag)
            })
            .collect();

        document.insert("tags".to_owned(), JsonValue::Array(named));
    }

    write_extension(
        context,
        &mut document,
        &ExtensionName::new("api"),
        JsonValue::Object(api_extension_value(ir)),
    );

    if let Some(format) = document_format {
        write_extension(
            context,
            &mut document,
            &ExtensionName::new("format"),
            text_value(format),
        );
    }

    write_consumer_extensions(&mut document, &ir.api.extensions);
    document.insert("paths".to_owned(), JsonValue::Object(paths));

    let mut components = JsonObject::new();

    if !schemas.is_empty() {
        components.insert("schemas".to_owned(), JsonValue::Object(schemas));
    }

    if !security_schemes.is_empty() {
        components.insert(
            "securitySchemes".to_owned(),
            JsonValue::Object(security_schemes),
        );
    }

    if !components.is_empty() {
        document.insert("components".to_owned(), JsonValue::Object(components));
    }

    Ok(document)
}

/// The value of the `x-seampact-api` extension: kind, role and caller.
pub(crate) fn api_extension_value(ir: &ContractIr) -> JsonObject {
    let mut api_value = JsonObject::new();

    api_value.insert("kind".to_owned(), text_value(ir.api.kind.as_str()));
    set_defined(
        &mut api_value,
        "role",
        optional_text(ir.api.role.as_ref().map(seampact_ir::ApiRole::as_str)),
    );

    if let Some(caller) = &ir.api.caller {
        let mut value = JsonObject::new();

        value.insert("identity".to_owned(), text_value(caller.identity.as_str()));
        value.insert("right".to_owned(), text_value(caller.right.as_str()));
        api_value.insert("caller".to_owned(), JsonValue::Object(value));
    }

    api_value
}

/// The `info` object: title, version, summary and description.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while an unknown version is refused by a stub.
fn info_object(context: &mut EmitContext<'_>) -> Result<JsonObject, OpenApiError> {
    let ir = context.ir;
    let mut info = JsonObject::new();

    info.insert("title".to_owned(), text_value(&ir.api.id));
    info.insert(
        "version".to_owned(),
        JsonValue::String(api_version_text(context)?),
    );
    set_defined(
        &mut info,
        "summary",
        optional_text(ir.api.docs.summary.as_deref()),
    );
    set_defined(
        &mut info,
        "description",
        optional_text(ir.api.docs.description.as_deref()),
    );

    Ok(info)
}

/// The api version as the text `info.version` holds.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while an unknown version is refused by a stub.
fn api_version_text(context: &mut EmitContext<'_>) -> Result<String, OpenApiError> {
    let version = &context.ir.api.version;
    let Ok(known) = KnownApiVersionRef::try_from(version) else {
        let location = IrLocation {
            member: "/api/version/kind".to_owned(),
            operation: None,
        };

        refuse_unknown(context, &location, version.tag())?;

        return Ok(String::new());
    };

    Ok(match known {
        KnownApiVersionRef::Path(path) => path.number.to_string(),
        KnownApiVersionRef::Label(label) => label.label.clone(),
    })
}

/// The format most operations use, the first by UTF-16 order on a tie.
pub(crate) fn most_used_format<'format>(formats: &[&'format str]) -> Option<&'format str> {
    let mut counts: IndexMap<&str, usize> = IndexMap::new();

    for format in formats {
        *counts.entry(format).or_insert(0) += 1;
    }

    let mut entries: Vec<(&str, usize)> = counts.into_iter().collect();

    entries.sort_by(|(left_format, left_count), (right_format, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| cmp_utf16(left_format, right_format))
    });

    entries.first().map(|(format, _)| *format)
}

/// The `paths` object of the selected operations.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while an operation is written by a stub.
fn paths_object(
    context: &mut EmitContext<'_>,
    selected: &[SelectedOperation<'_>],
    document_format: Option<&str>,
) -> Result<JsonObject, OpenApiError> {
    paths_by_route(
        selected,
        |entry| Route {
            path: &entry.operation.path,
            method: entry.operation.method.as_str(),
        },
        |entry| operation_object(context, entry.operation, entry.index, document_format),
    )
}

/// The path and method an entry answers.
pub(crate) struct Route<'entry> {
    /// The path.
    pub(crate) path: &'entry str,
    /// The HTTP method.
    pub(crate) method: &'entry str,
}

/// The servers of the options as the `servers` array.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
fn servers_array(_options: &EmitterOptions) -> Result<JsonValue, OpenApiError> {
    Err(not_ported_yet("serversArray"))
}

/// Paths by UTF-16 order, each holding its operations by method rank.
///
/// # Errors
///
/// As the writer of an operation, and [`OpenApiError::NotPortedYet`] while the method rank is a
/// stub.
pub(crate) fn paths_by_route<'entry, Entry>(
    entries: &'entry [Entry],
    route_of: impl Fn(&'entry Entry) -> Route<'entry>,
    mut operation_object_of: impl FnMut(&'entry Entry) -> Result<JsonObject, OpenApiError>,
) -> Result<JsonObject, OpenApiError> {
    let mut by_path: IndexMap<&str, Vec<&'entry Entry>> = IndexMap::new();

    for entry in entries {
        by_path.entry(route_of(entry).path).or_default().push(entry);
    }

    let mut sorted_paths: Vec<&str> = by_path.keys().copied().collect();

    sorted_paths.sort_by(|left, right| cmp_utf16(left, right));

    let mut paths = JsonObject::new();

    for path in sorted_paths {
        let path_entries = by_path.get(path).map_or(&[][..], Vec::as_slice);
        let mut ranked = path_entries
            .iter()
            .map(|entry| method_rank(route_of(entry).method).map(|rank| (rank, *entry)))
            .collect::<Result<Vec<_>, _>>()?;

        ranked.sort_by_key(|(rank, _)| *rank);

        let mut path_item = JsonObject::new();

        for (_, entry) in ranked {
            path_item.insert(
                route_of(entry).method.to_owned(),
                JsonValue::Object(operation_object_of(entry)?),
            );
        }

        paths.insert(path.to_owned(), JsonValue::Object(path_item));
    }

    Ok(paths)
}

/// The position of a method in a path item.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
fn method_rank(_method: &str) -> Result<usize, OpenApiError> {
    Err(not_ported_yet("methodRank"))
}

/// The object of one operation.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
fn operation_object(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _index: usize,
    _document_format: Option<&str>,
) -> Result<JsonObject, OpenApiError> {
    Err(not_ported_yet("operationObject"))
}

/// Writes every component referenced, those they reference included, sorted by key.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] while a component is written by a stub.
fn drain_schema_components(context: &mut EmitContext<'_>) -> Result<JsonObject, OpenApiError> {
    let mut written: IndexMap<String, JsonObject> = IndexMap::new();

    while let Some(request) = context.pending_components.pop_front() {
        let schema = (request.build)(context)?;

        written.insert(request.key, schema);
    }

    let mut keys: Vec<String> = written.keys().cloned().collect();

    keys.sort_by(|left, right| cmp_utf16(left, right));

    let mut schemas = JsonObject::new();

    for key in keys {
        if let Some(schema) = written.swap_remove(&key) {
            schemas.insert(key, JsonValue::Object(schema));
        }
    }

    Ok(schemas)
}

#[cfg(test)]
mod tests {
    use crate::emit_context::{ComponentRequest, fixture_ir, reference_component};

    use super::*;

    #[test]
    fn the_most_used_format_wins_and_a_tie_goes_to_the_first_in_utf16_order() {
        assert_eq!(most_used_format(&[]), None);
        assert_eq!(most_used_format(&["json", "text", "text"]), Some("text"));
        assert_eq!(most_used_format(&["text", "json"]), Some("json"));
        // U+10000 is a surrogate pair, which sorts before U+E000 in UTF-16.
        assert_eq!(
            most_used_format(&["\u{e000}", "\u{10000}"]),
            Some("\u{10000}")
        );
    }

    #[test]
    fn components_are_drained_in_reference_order_and_sorted_by_utf16_key()
    -> Result<(), Box<dyn std::error::Error>> {
        let ir = fixture_ir()?;
        let options = EmitterOptions::default();
        let mut context = create_emit_context(&ir, &options);
        let nested = ComponentRequest {
            key: "\u{e000}".to_owned(),
            build: Box::new(|inner| {
                let request = ComponentRequest {
                    key: "\u{10000}".to_owned(),
                    build: Box::new(|_| Ok(JsonObject::new())),
                };

                reference_component(inner, request);

                Ok(JsonObject::new())
            }),
        };

        reference_component(&mut context, nested);

        let schemas = drain_schema_components(&mut context)?;
        let keys: Vec<&str> = schemas.keys().map(String::as_str).collect();

        assert_eq!(keys, ["\u{10000}", "\u{e000}"]);
        assert!(context.pending_components.is_empty());

        Ok(())
    }

    #[test]
    fn a_document_declaring_none_has_one_unnamed_plan_over_every_surface()
    -> Result<(), Box<dyn std::error::Error>> {
        let ir = fixture_ir()?;
        let plans = document_plans(&ir);

        assert_eq!(plans.len(), 1);
        assert_eq!(plans.first().map(|plan| plan.name.is_none()), Some(true));
        assert_eq!(
            plans.first().map(|plan| plan.selection.surfaces.len()),
            Some(ir.api.surfaces.len())
        );

        Ok(())
    }
}
