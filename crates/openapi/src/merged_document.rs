//! The api documents of a merged document written as one: an element two apis write identically
//! is kept once, two different elements under one name are refused with the `prefix` fix, and a
//! method and path is always one api's.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue, stringify_json};
use seampact_target::{Refusal, refusal_code};

use crate::documents::{OPENAPI_VERSION, Route, most_used_format, paths_by_route, servers_array};
use crate::emit_context::{EXTENSION_PREFIX, extension_member, is_extension_selected};
use crate::merge_documents::MergeOptions;
use crate::{ExtensionName, OpenApiError};

/// The component sections a merged document holds.
const COMPONENT_SECTIONS: [&str; 2] = ["schemas", "securitySchemes"];

/// The root members an api document holds besides its consumer extensions, each merged below.
const PLAIN_ROOT_MEMBERS: [&str; 5] = ["openapi", "info", "servers", "tags", "paths"];

/// The root member that holds the components.
const COMPONENTS_MEMBER: &str = "components";

/// One api's document, mapped and prefixed, with what `x-seampact-api` says of the api.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ApiSource {
    /// The api id.
    pub(crate) api: String,
    /// The `x-seampact-api` value of the api.
    pub(crate) api_value: JsonObject,
    /// The api's document.
    pub(crate) document: JsonObject,
}

/// The merged document and the refusals met while assembling it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AssembledDocument {
    /// The merged document.
    pub(crate) document: JsonObject,
    /// The refusals, in the order the apis were placed.
    pub(crate) refusals: Vec<Refusal>,
}

/// An element placed in the merged document, with the api it came from and how a refusal names it.
struct Placed {
    api: String,
    label: String,
    value: JsonValue,
}

/// A placed operation, with where it answers.
struct PlacedOperation {
    placed: Placed,
    path: String,
    method: String,
}

impl AsRef<Placed> for Placed {
    fn as_ref(&self) -> &Placed {
        self
    }
}

impl AsRef<Placed> for PlacedOperation {
    fn as_ref(&self) -> &Placed {
        &self.placed
    }
}

/// What two elements of one name have in common, which words the refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClashKind {
    Name,
    Route,
    Path,
}

/// What the placed elements of all apis make up, before the merged document is written.
struct Assembly {
    refusals: Vec<Refusal>,
    tags: IndexMap<String, Placed>,
    headers: IndexMap<String, Placed>,
    path_spellings: IndexMap<String, Placed>,
    routes: IndexMap<String, PlacedOperation>,
    operation_ids: IndexMap<String, Placed>,
    components: IndexMap<&'static str, IndexMap<String, Placed>>,
}

/// The merged document of the sources, and the refusals met placing them.
///
/// # Errors
///
/// [`OpenApiError::Internal`] for a document member, a component section or a name the merge has
/// no rule for, which the document mapping must write.
pub(crate) fn assemble_merged_document(
    sources: &[ApiSource],
    options: &MergeOptions,
) -> Result<AssembledDocument, OpenApiError> {
    let mut assembly = Assembly {
        refusals: Vec::new(),
        tags: IndexMap::new(),
        headers: IndexMap::new(),
        path_spellings: IndexMap::new(),
        routes: IndexMap::new(),
        operation_ids: IndexMap::new(),
        components: COMPONENT_SECTIONS
            .iter()
            .map(|section| (*section, IndexMap::new()))
            .collect(),
    };

    for source in sources {
        place_source(&mut assembly, source)?;
    }

    let document = merged_document(&assembly, options)?;

    Ok(AssembledDocument {
        document,
        refusals: assembly.refusals,
    })
}

fn place_source(assembly: &mut Assembly, source: &ApiSource) -> Result<(), OpenApiError> {
    let ApiSource { api, document, .. } = source;

    for member in document.keys() {
        if !is_merged_root_member(member) && !is_consumer_extension(member) {
            return Err(InternalError::new(format!(
                "the merge does not know the document member '{member}' of the api {api}: give it a merge rule beside its table row"
            ))
            .into());
        }
    }

    let header = Placed {
        api: api.clone(),
        label: format!("the api '{api}'"),
        value: JsonValue::Object(api_header(source)?),
    };

    place(
        &mut assembly.refusals,
        &mut assembly.headers,
        api,
        header,
        ClashKind::Name,
    );

    for tag in document.array_member("tags") {
        let name = string_member(tag, "name", &format!("a tag of the api {api}"))?;
        let placed_tag = Placed {
            api: api.clone(),
            label: format!("the tag '{name}'"),
            value: tag.clone(),
        };

        place(
            &mut assembly.refusals,
            &mut assembly.tags,
            &name,
            placed_tag,
            ClashKind::Name,
        );
    }

    if let Some(components) = document.object_member(COMPONENTS_MEMBER) {
        place_components(assembly, api, components)?;
    }

    place_operations(assembly, api, document)
}

fn is_merged_root_member(member: &str) -> bool {
    PLAIN_ROOT_MEMBERS.contains(&member)
        || member == extension_member(ExtensionName::Api)
        || member == extension_member(ExtensionName::Format)
        || member == COMPONENTS_MEMBER
}

fn place_components(
    assembly: &mut Assembly,
    api: &str,
    components: &JsonObject,
) -> Result<(), OpenApiError> {
    for (section, entries) in components {
        let Some(placed) = assembly.components.get_mut(section.as_str()) else {
            return Err(InternalError::new(format!(
                "the merge does not know the component section '{section}' of the api {api}: give it a merge rule beside its table row"
            ))
            .into());
        };

        let JsonValue::Object(keyed) = entries else {
            continue;
        };

        for (key, value) in keyed {
            let candidate = Placed {
                api: api.to_owned(),
                label: format!("the component '{section}.{key}'"),
                value: value.clone(),
            };

            place(
                &mut assembly.refusals,
                placed,
                key,
                candidate,
                ClashKind::Name,
            );
        }
    }

    Ok(())
}

fn place_operations(
    assembly: &mut Assembly,
    api: &str,
    document: &JsonObject,
) -> Result<(), OpenApiError> {
    let format_member = extension_member(ExtensionName::Format);
    let document_format = document.get(&format_member);

    for (path, path_item) in document.object_member("paths").into_iter().flatten() {
        let JsonValue::Object(operations) = path_item else {
            continue;
        };

        for (method, operation) in operations {
            let JsonValue::Object(operation_object) = operation else {
                continue;
            };
            let mut placed_operation = operation_object.clone();

            if let Some(format) = document_format
                && !placed_operation.contains_key(&format_member)
            {
                placed_operation.insert(format_member.clone(), format.clone());
            }

            let route = format!("{} {path}", method.to_uppercase());
            let operation_id =
                string_member(operation, "operationId", &format!("the operation {route}"))?;
            let label = format!("the operation '{operation_id}' ({route})");
            let path_shape = blank_path_parameters(path);
            let spelling = Placed {
                api: api.to_owned(),
                label: format!("the path '{path}'"),
                value: JsonValue::text(path),
            };

            place(
                &mut assembly.refusals,
                &mut assembly.path_spellings,
                &path_shape,
                spelling,
                ClashKind::Path,
            );

            let route_key = stringify_json(&JsonValue::Array(vec![
                JsonValue::text(&path_shape),
                JsonValue::text(method),
            ]));
            let placed_route = PlacedOperation {
                placed: Placed {
                    api: api.to_owned(),
                    label: label.clone(),
                    value: JsonValue::Object(placed_operation),
                },
                path: path.clone(),
                method: method.clone(),
            };

            place(
                &mut assembly.refusals,
                &mut assembly.routes,
                &route_key,
                placed_route,
                ClashKind::Route,
            );

            let id_entry = Placed {
                api: api.to_owned(),
                label,
                value: JsonValue::text(&route),
            };

            place(
                &mut assembly.refusals,
                &mut assembly.operation_ids,
                &operation_id,
                id_entry,
                ClashKind::Name,
            );
        }
    }

    Ok(())
}

/// A path template with its parameter names blanked: two paths of one shape are one path (OAS 3.1).
fn blank_path_parameters(path: &str) -> String {
    let mut blanked = String::with_capacity(path.len());
    let mut rest = path;

    while let Some(open) = rest.find('{') {
        let (before, from_open) = rest.split_at(open);
        let after_open = from_open.strip_prefix('{').unwrap_or(from_open);

        blanked.push_str(before);

        let closes_a_parameter = after_open
            .find(['{', '}'])
            .filter(|end| *end > 0)
            .and_then(|end| after_open.split_at_checked(end))
            .and_then(|(_, tail)| tail.strip_prefix('}'));

        if let Some(tail) = closes_a_parameter {
            blanked.push_str("{}");
            rest = tail;
        } else {
            blanked.push('{');
            rest = after_open;
        }
    }

    blanked.push_str(rest);

    blanked
}

/// Keeps the first element of a key; a different second one is a refusal, and so is a route two
/// apis both write.
fn place<Entry: AsRef<Placed>>(
    refusals: &mut Vec<Refusal>,
    placed: &mut IndexMap<String, Entry>,
    key: &str,
    candidate: Entry,
    kind: ClashKind,
) {
    let Some(first) = placed.get(key) else {
        placed.insert(key.to_owned(), candidate);

        return;
    };
    let first_placed = first.as_ref();
    let candidate_placed = candidate.as_ref();
    let same_value = first_placed.value == candidate_placed.value;
    let route_of_two_apis = kind == ClashKind::Route && first_placed.api != candidate_placed.api;

    if same_value && !route_of_two_apis {
        return;
    }

    refusals.push(clash_refusal(first_placed, candidate_placed, kind));
}

fn clash_refusal(first: &Placed, second: &Placed, kind: ClashKind) -> Refusal {
    let message = format!(
        "{} of the api '{}' and {} of the api '{}'",
        first.label, first.api, second.label, second.api
    );

    if first.api == second.api {
        return Refusal::new(
            refusal_code::OPENAPI_MERGE_API_VERSIONS,
            format!("{message} differ: two apps give different versions of the api."),
            format!(
                "Build every app the merged document covers from the same version of the api '{}', or give two different apis distinct api ids.",
                first.api
            ),
        );
    }

    match kind {
        ClashKind::Route => Refusal::new(
            refusal_code::OPENAPI_MERGE_ROUTE_CLASH,
            format!("{message} answer the same method and path."),
            "Give one of the operations a distinct contract path, or write the apis in separate merged documents.".to_owned(),
        ),
        ClashKind::Path => Refusal::new(
            refusal_code::OPENAPI_MERGE_ROUTE_CLASH,
            format!("{message} are one path under different parameter names."),
            "Give the path parameters the same names in both contracts, or write the apis in separate merged documents.".to_owned(),
        ),
        ClashKind::Name => Refusal::new(
            refusal_code::OPENAPI_MERGE_NAME_CLASH,
            format!("{message} are different elements under one name."),
            format!(
                "Set a prefix for '{}' or '{}' in the merged document's 'prefix', such as '{}: {}'.",
                first.api, second.api, second.api, second.api
            ),
        ),
    }
}

fn merged_document(
    assembly: &Assembly,
    options: &MergeOptions,
) -> Result<JsonObject, OpenApiError> {
    let emitter = &options.emitter;
    let info = JsonObject::from_members([
        ("title", JsonValue::text(&options.name)),
        ("version", JsonValue::String(merged_version(assembly)?)),
    ]);
    let mut document = JsonObject::from_members([
        ("openapi", JsonValue::text(OPENAPI_VERSION)),
        ("info", JsonValue::Object(info)),
    ]);

    if !emitter.servers.is_empty() {
        document.insert("servers".to_owned(), servers_array(emitter));
    }

    let tags = sorted_values(&assembly.tags);

    if !tags.is_empty() {
        document.insert("tags".to_owned(), JsonValue::Array(tags));
    }

    if is_extension_selected(&emitter.extensions, ExtensionName::Apis) {
        document.insert(
            extension_member(ExtensionName::Apis),
            JsonValue::Array(sorted_values(&assembly.headers)),
        );
    }

    let format_member = extension_member(ExtensionName::Format);
    let operations: Vec<&PlacedOperation> = assembly.routes.values().collect();
    let formats: Vec<&str> = operations
        .iter()
        .filter_map(|operation| match &operation.placed.value {
            JsonValue::Object(written) => match written.get(&format_member) {
                Some(JsonValue::String(format)) => Some(format.as_str()),
                _ => None,
            },
            _ => None,
        })
        .collect();
    let format = most_used_format(&formats);

    if let Some(most_used) = format {
        document.insert(format_member, JsonValue::text(most_used));
    }

    let write_source_api = is_extension_selected(&emitter.extensions, ExtensionName::SourceApi);

    document.insert(
        "paths".to_owned(),
        JsonValue::Object(merged_paths(&operations, format, write_source_api)?),
    );

    let mut components = JsonObject::new();

    for (section, placed) in &assembly.components {
        if placed.is_empty() {
            continue;
        }

        let entries: JsonObject = sorted_entries(placed)
            .into_iter()
            .map(|(key, entry)| (key.clone(), entry.value.clone()))
            .collect();

        components.insert((*section).to_owned(), JsonValue::Object(entries));
    }

    if !components.is_empty() {
        document.insert(COMPONENTS_MEMBER.to_owned(), JsonValue::Object(components));
    }

    Ok(document)
}

fn merged_version(assembly: &Assembly) -> Result<String, OpenApiError> {
    let mut versions = Vec::new();

    for (api, entry) in sorted_entries(&assembly.headers) {
        let version = string_member(&entry.value, "version", &format!("the api {api}"))?;

        versions.push(format!("{api} {version}"));
    }

    Ok(versions.join(", "))
}

/// The `x-seampact-api` header of an api: its name, kind and role, its version and summary, and
/// the consumer extensions of its document.
fn api_header(source: &ApiSource) -> Result<JsonObject, OpenApiError> {
    let ApiSource {
        api,
        api_value,
        document,
    } = source;
    let info = document.object_member("info");
    let mut header = JsonObject::from_members([("name", JsonValue::text(api))]);

    for (member, value) in api_value {
        header.insert(member.clone(), value.clone());
    }

    let info_value = info.map_or(JsonValue::Null, |found| JsonValue::Object(found.clone()));
    let version = string_member(
        &info_value,
        "version",
        &format!("the info of the api {api}"),
    )?;

    header.insert("version".to_owned(), JsonValue::String(version));

    for member in ["summary", "description"] {
        if let Some(value) = info.and_then(|found| found.get(member)) {
            header.insert(member.to_owned(), value.clone());
        }
    }

    for (member, value) in document {
        if is_consumer_extension(member) {
            header.insert(member.clone(), value.clone());
        }
    }

    Ok(header)
}

fn merged_paths(
    operations: &[&PlacedOperation],
    document_format: Option<&str>,
    write_source_api: bool,
) -> Result<JsonObject, OpenApiError> {
    paths_by_route(
        operations,
        |operation| Route {
            path: &operation.path,
            method: &operation.method,
        },
        |operation| {
            Ok(merged_operation(
                operation,
                document_format,
                write_source_api,
            ))
        },
    )
}

fn merged_operation(
    placed: &PlacedOperation,
    document_format: Option<&str>,
    write_source_api: bool,
) -> JsonObject {
    let mut operation = match &placed.placed.value {
        JsonValue::Object(written) => written.clone(),
        _ => JsonObject::new(),
    };
    let format_member = extension_member(ExtensionName::Format);

    if let (Some(JsonValue::String(format)), Some(merged_format)) =
        (operation.get(&format_member), document_format)
        && format == merged_format
    {
        operation.remove(&format_member);
    }

    if write_source_api {
        operation.insert(
            extension_member(ExtensionName::SourceApi),
            JsonValue::text(&placed.placed.api),
        );
    }

    operation
}

fn sorted_entries<Entry>(placed: &IndexMap<String, Entry>) -> Vec<(&String, &Entry)> {
    let mut entries: Vec<(&String, &Entry)> = placed.iter().collect();

    entries.sort_by(|(left, _), (right, _)| cmp_utf16(left, right));

    entries
}

fn sorted_values(placed: &IndexMap<String, Placed>) -> Vec<JsonValue> {
    sorted_entries(placed)
        .into_iter()
        .map(|(_, entry)| entry.value.clone())
        .collect()
}

fn is_consumer_extension(member: &str) -> bool {
    member.starts_with("x-") && !member.starts_with(EXTENSION_PREFIX)
}

fn string_member(value: &JsonValue, member: &str, holder: &str) -> Result<String, OpenApiError> {
    if let JsonValue::Object(object) = value
        && let Some(JsonValue::String(text)) = object.get(member)
    {
        return Ok(text.clone());
    }

    Err(InternalError::new(format!(
        "the merge reads no string '{member}' in {holder}: the api's document mapping must write it"
    ))
    .into())
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;

    use super::*;
    use crate::EmitterOptions;
    use crate::json_value::object_from_text;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn source(api: &str, document: &str) -> Result<ApiSource, Box<dyn std::error::Error>> {
        let mut document = object_from_text(document)?;
        let info = object_from_text(r#"{"title": "t", "version": "1"}"#)?;

        if !document.contains_key("info") {
            document.insert("info".to_owned(), JsonValue::Object(info));
        }

        Ok(ApiSource {
            api: api.to_owned(),
            api_value: object_from_text(r#"{"kind": "http"}"#)?,
            document,
        })
    }

    fn assemble(sources: &[ApiSource]) -> Result<AssembledDocument, OpenApiError> {
        let options = MergeOptions {
            name: "platform".to_owned(),
            prefix: IndexMap::new(),
            emitter: EmitterOptions::default(),
        };

        assemble_merged_document(sources, &options)
    }

    fn codes(assembled: &AssembledDocument) -> Vec<&str> {
        assembled
            .refusals
            .iter()
            .map(|refusal| refusal.code.as_str())
            .collect()
    }

    const ONE_SCHEMA: &str = r#"{"components": {"schemas": {"Task": {"type": "string"}}}}"#;
    const OTHER_SCHEMA: &str = r#"{"components": {"schemas": {"Task": {"type": "integer"}}}}"#;

    #[test]
    fn an_element_two_apis_write_identically_is_kept_once() -> TestResult {
        let assembled = assemble(&[source("a", ONE_SCHEMA)?, source("b", ONE_SCHEMA)?])?;

        assert_eq!(codes(&assembled), Vec::<&str>::new());

        Ok(())
    }

    #[test]
    fn two_different_elements_under_one_name_are_a_name_clash_naming_both_apis() -> TestResult {
        let assembled = assemble(&[source("a", ONE_SCHEMA)?, source("b", OTHER_SCHEMA)?])?;

        assert_eq!(codes(&assembled), ["openapi.merge.name-clash"]);
        assert_eq!(
            assembled
                .refusals
                .first()
                .map(|refusal| refusal.message.as_str()),
            Some(
                "the component 'schemas.Task' of the api 'a' and the component 'schemas.Task' of the api 'b' are different elements under one name."
            )
        );

        Ok(())
    }

    #[test]
    fn one_api_in_two_versions_is_an_api_versions_refusal() -> TestResult {
        let assembled = assemble(&[source("a", ONE_SCHEMA)?, source("a", OTHER_SCHEMA)?])?;

        assert_eq!(codes(&assembled), ["openapi.merge.api-versions"]);

        Ok(())
    }

    const GET_TASKS: &str = r#"{"paths": {"/tasks/{id}": {"get": {"operationId": "getTask"}}}}"#;

    #[test]
    fn two_apis_answering_one_method_and_path_clash_even_when_identical() -> TestResult {
        let assembled = assemble(&[source("a", GET_TASKS)?, source("b", GET_TASKS)?])?;

        assert!(codes(&assembled).contains(&"openapi.merge.route-clash"));

        Ok(())
    }

    #[test]
    fn one_path_under_different_parameter_names_is_a_route_clash() -> TestResult {
        let other = r#"{"paths": {"/tasks/{taskId}": {"get": {"operationId": "other"}}}}"#;
        let assembled = assemble(&[source("a", GET_TASKS)?, source("b", other)?])?;

        assert!(assembled.refusals.iter().any(|refusal| {
            refusal
                .message
                .ends_with("are one path under different parameter names.")
        }));

        Ok(())
    }

    #[test]
    fn the_bytes_do_not_depend_on_the_order_of_the_inputs() -> TestResult {
        let first = source("a", ONE_SCHEMA)?;
        let second = source(
            "b",
            r#"{"components": {"schemas": {"Other": {"type": "string"}}}}"#,
        )?;
        let forward = assemble(&[first.clone(), second.clone()])?;
        let backward = assemble(&[second, first])?;

        assert_eq!(forward.document, backward.document);

        Ok(())
    }

    #[test]
    fn a_document_member_the_merge_has_no_rule_for_is_an_internal_error() -> TestResult {
        let result = assemble(&[source("a", r#"{"webhooks": {}}"#)?]);

        assert!(matches!(result, Err(OpenApiError::Internal(_))));

        Ok(())
    }

    #[test]
    fn path_parameter_names_are_blanked_like_the_regular_expression_does() {
        for (path, shape) in [
            ("/tasks/{id}", "/tasks/{}"),
            ("/a/{x}/b/{yy}", "/a/{}/b/{}"),
            ("/a/{}", "/a/{}"),
            ("/{a{b}", "/{a{}"),
            ("/{open", "/{open"),
            ("/a}{", "/a}{"),
            ("/\u{1F600}/{\u{e9}}", "/\u{1F600}/{}"),
        ] {
            assert_eq!(blank_path_parameters(path), shape, "path {path:?}");
        }
    }

    #[test]
    fn components_are_sorted_in_utf16_order_then_written_in_key_order() -> TestResult {
        let document = r#"{"components": {"schemas": {"\uff5e": {}, "\ud83d\ude00": {}, "10": {}, "9": {}, "b": {}}}}"#;
        let assembled = assemble(&[source("a", document)?])?;
        let Some(JsonValue::Object(components)) = assembled.document.get("components") else {
            return Err("no components".into());
        };
        let Some(JsonValue::Object(schemas)) = components.get("schemas") else {
            return Err("no schemas".into());
        };
        let keys: Vec<&str> = schemas.keys().map(String::as_str).collect();

        // The astral character sorts before U+FF5E in UTF-16, after it by bytes; array-index keys go first.
        assert_eq!(keys, ["9", "10", "b", "\u{1F600}", "\u{ff5e}"]);

        Ok(())
    }
}
