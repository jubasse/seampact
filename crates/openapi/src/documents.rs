//! The OpenAPI documents of one api.

use std::collections::BTreeSet;

use indexmap::{IndexMap, IndexSet};
use seampact_ir::{
    ApiDocument, ContractIr, DocumentId, IR_REVISION, IR_VERSION, InternalPolicy, IrSupport,
    KnownApiVersionRef, Operation, check_contract_ir_support,
};
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, Refusal, without_repeats};

use crate::bodies::request_body;
use crate::emit_context::{
    EmitContext, create_emit_context, refuse_inconsistent, refuse_unknown,
    write_consumer_extensions, write_extension,
};
use crate::errors::error_responses;
use crate::examples::{ExampleSet, collect_examples};
use crate::json_value::{optional_text, set_defined};
use crate::operation_marks::write_operation_marks;
use crate::paging::write_paging;
use crate::parameters::operation_parameters;
use crate::responses::success_responses;
use crate::rights::write_operation_rights;
use crate::security::security_schemes_component;
use crate::security::write_operation_security;
use crate::serialize::serialize_document;
use crate::{EmitterOptions, ExtensionName, OpenApiError};

/// The methods of a path item, in the order its operations are written.
const METHOD_ORDER: [&str; 8] = [
    "get", "put", "post", "delete", "options", "head", "patch", "trace",
];

/// The OpenAPI version every document declares.
pub(crate) const OPENAPI_VERSION: &str = "3.1.0";

/// The declaration kind of an HTTP operation.
const HTTP_OPERATION_KIND: &str = "httpOperation";

/// What to do about an IR this release does not read.
const UNSUPPORTED_IR_FIX: &str =
    "Use the @seampact/openapi release built for the IR this seampact version writes.";

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
pub(crate) struct PlannedDocument {
    /// The document.
    pub(crate) document: JsonObject,
    /// The refusals met while writing it.
    pub(crate) refusals: Vec<Refusal>,
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
/// [`OpenApiError::Internal`] for a bug.
pub fn emit_documents(
    ir: &ContractIr,
    options: &EmitterOptions,
) -> Result<EmitOutcome, OpenApiError> {
    let unsupported = unsupported_ir_refusals(ir);

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
pub(crate) fn unsupported_ir_refusals(ir: &ContractIr) -> Vec<Refusal> {
    let support = IrSupport {
        ir_versions: &[IR_VERSION],
        ir_revision: IR_REVISION,
        kinds: &[HTTP_OPERATION_KIND],
        features: &[],
    };

    check_contract_ir_support(ir, &support)
        .into_iter()
        .map(|mismatch| {
            Refusal::new(mismatch.code.as_str(), mismatch.message, UNSUPPORTED_IR_FIX)
                .with_operation(mismatch.operation)
                .with_member(mismatch.member)
        })
        .collect()
}

/// One planned document and the refusals met while writing it.
pub(crate) fn build_planned_document(
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
    let security_schemes = security_schemes_component(context);
    let mut document = JsonObject::from_iter([
        ("openapi".to_owned(), JsonValue::text(OPENAPI_VERSION)),
        ("info".to_owned(), JsonValue::Object(info_object(context))),
    ]);

    if !context.options.servers.is_empty() {
        document.insert("servers".to_owned(), servers_array(context.options));
    }

    let tags = tag_objects(&selected);

    if !tags.is_empty() {
        document.insert("tags".to_owned(), JsonValue::Array(tags));
    }

    write_extension(
        context,
        &mut document,
        ExtensionName::Api,
        JsonValue::Object(api_extension_value(ir)),
    );

    if let Some(format) = document_format {
        write_extension(
            context,
            &mut document,
            ExtensionName::Format,
            JsonValue::text(format),
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

/// The `tags` array: one `{ name }` per tag the selected operations use, by UTF-16 order.
fn tag_objects(selected: &[SelectedOperation<'_>]) -> Vec<JsonValue> {
    let mut tags: Vec<&str> = selected
        .iter()
        .flat_map(|entry| entry.operation.tags.iter().map(String::as_str))
        .collect::<IndexSet<&str>>()
        .into_iter()
        .collect();

    tags.sort_by(|left, right| cmp_utf16(left, right));

    tags.into_iter()
        .map(|name| {
            JsonValue::Object(JsonObject::from_iter([(
                "name".to_owned(),
                JsonValue::text(name),
            )]))
        })
        .collect()
}

/// The value of the `x-seampact-api` extension: kind, role and caller.
pub(crate) fn api_extension_value(ir: &ContractIr) -> JsonObject {
    let mut api_value =
        JsonObject::from_iter([("kind".to_owned(), JsonValue::text(ir.api.kind.as_str()))]);

    set_defined(
        &mut api_value,
        "role",
        optional_text(ir.api.role.as_ref().map(seampact_ir::ApiRole::as_str)),
    );

    if let Some(caller) = &ir.api.caller {
        let value = JsonObject::from_iter([
            (
                "identity".to_owned(),
                JsonValue::text(caller.identity.as_str()),
            ),
            ("right".to_owned(), JsonValue::text(caller.right.as_str())),
        ]);

        api_value.insert("caller".to_owned(), JsonValue::Object(value));
    }

    api_value
}

/// The `info` object: title, version, summary and description.
fn info_object(context: &mut EmitContext<'_>) -> JsonObject {
    let ir = context.ir;
    let version = api_version_text(context);
    let mut info = JsonObject::from_iter([
        ("title".to_owned(), JsonValue::text(&ir.api.id)),
        ("version".to_owned(), JsonValue::String(version)),
    ]);

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

    info
}

/// The api version as the text `info.version` holds.
fn api_version_text(context: &mut EmitContext<'_>) -> String {
    let version = &context.ir.api.version;
    let Ok(known) = KnownApiVersionRef::try_from(version) else {
        let location = IrLocation {
            member: "/api/version/kind".to_owned(),
            operation: None,
        };

        refuse_unknown(context, &location, version.tag());

        return String::new();
    };

    match known {
        KnownApiVersionRef::Path(path) => path.number.to_string(),
        KnownApiVersionRef::Label(label) => label.label.clone(),
    }
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
fn paths_object<'ir>(
    context: &mut EmitContext<'ir>,
    selected: &[SelectedOperation<'ir>],
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
pub(crate) fn servers_array(options: &EmitterOptions) -> JsonValue {
    let servers = options
        .servers
        .iter()
        .map(|server| {
            let mut server_object = JsonObject::new();

            server_object.insert("url".to_owned(), JsonValue::text(&server.url));
            set_defined(
                &mut server_object,
                "description",
                optional_text(server.description.as_deref()),
            );

            JsonValue::Object(server_object)
        })
        .collect();

    JsonValue::Array(servers)
}

/// Paths by UTF-16 order, each holding its operations by method rank.
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
        let mut ranked: Vec<(usize, &&Entry)> = path_entries
            .iter()
            .map(|entry| (method_rank(route_of(entry).method), entry))
            .collect();

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

/// The position of a method in a path item; a method no list names goes last.
fn method_rank(method: &str) -> usize {
    METHOD_ORDER
        .iter()
        .position(|ordered| *ordered == method)
        .unwrap_or(METHOD_ORDER.len())
}

/// The object of one operation: its docs, parameters, bodies, responses, security and marks.
///
/// # Errors
///
/// As the writers of its parts.
fn operation_object<'ir>(
    context: &mut EmitContext<'ir>,
    operation: &'ir Operation,
    index: usize,
    document_format: Option<&str>,
) -> Result<JsonObject, OpenApiError> {
    let location = IrLocation::operation_location(index, operation.id.clone());
    let mut object = JsonObject::new();

    if !operation.tags.is_empty() {
        let tags = operation
            .tags
            .iter()
            .map(|tag| JsonValue::text(tag))
            .collect();

        object.insert("tags".to_owned(), JsonValue::Array(tags));
    }

    set_defined(
        &mut object,
        "summary",
        optional_text(operation.docs.summary.as_deref()),
    );
    set_defined(
        &mut object,
        "description",
        optional_text(operation.docs.description.as_deref()),
    );
    object.insert(
        "operationId".to_owned(),
        JsonValue::text(operation.id.as_str()),
    );

    if operation.deprecated.is_some() {
        object.insert("deprecated".to_owned(), JsonValue::Bool(true));
    }

    let parameters = operation_parameters(context, operation, &location)?;

    if !parameters.is_empty() {
        let written = parameters.into_iter().map(JsonValue::Object).collect();

        object.insert("parameters".to_owned(), JsonValue::Array(written));
    }

    let examples = collect_examples(context, operation, &location);
    let body = request_body(context, operation, examples.request.as_ref(), &location)?;

    if let Some(request_body) = body {
        object.insert("requestBody".to_owned(), JsonValue::Object(request_body));
    }

    let responses = responses_object(context, operation, &examples, &location)?;

    object.insert("responses".to_owned(), JsonValue::Object(responses));
    write_operation_security(context, operation, &mut object, &location);
    write_operation_rights(context, operation, &mut object, &location);
    write_paging(context, operation, &mut object, &location);
    write_operation_marks(context, operation, document_format, &mut object, &location);
    write_consumer_extensions(&mut object, &operation.extensions);

    Ok(object)
}

/// The `responses` of an operation: success and error responses by status.
fn responses_object<'ir>(
    context: &mut EmitContext<'ir>,
    operation: &'ir Operation,
    examples: &ExampleSet<'_>,
    location: &IrLocation,
) -> Result<JsonObject, OpenApiError> {
    let mut success = success_responses(context, operation, examples, location)?;
    let mut errors = error_responses(context, operation, location);
    let statuses: BTreeSet<i64> = success.keys().chain(errors.keys()).copied().collect();
    let mut responses = JsonObject::new();

    for status in statuses {
        if success.contains_key(&status) && errors.contains_key(&status) {
            refuse_inconsistent(
                context,
                "response.status",
                &format!("The status {status} is both a success and an error response"),
                location,
            );
        }

        let response = success
            .shift_remove(&status)
            .or_else(|| errors.shift_remove(&status));

        if let Some(written) = response {
            responses.insert(status.to_string(), JsonValue::Object(written));
        }
    }

    Ok(responses)
}

/// Writes every component referenced, those they reference included, sorted by key.
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
}
