//! The value each member of an operation shows as in `seampact explain`.

use seampact_json::{JsonObject, JsonValue};

use crate::CliError;
use crate::explain_flow::{items_of, object_of, type_text};
use crate::not_ported::not_ported_yet;

const JSON_MEDIA: &str = "application/json";

/// The members of `value` except its provenance, `origin` and `derivedFrom`; a value that is not
/// a mapping has no members.
pub(crate) fn without_provenance(value: &JsonValue) -> JsonValue {
    let JsonValue::Object(object) = value else {
        return JsonValue::Object(JsonObject::new());
    };

    JsonValue::Object(
        object
            .iter()
            .filter(|(member, _)| member.as_str() != "origin" && member.as_str() != "derivedFrom")
            .map(|(member, member_value)| (member.clone(), member_value.clone()))
            .collect(),
    )
}

/// The `unknownQuery` policy, or `{ ignore: <reason> }` for an ignored one that says why.
pub(crate) fn unknown_query_value(unknown_query: &JsonValue) -> JsonValue {
    let Some(object) = object_of(Some(unknown_query)) else {
        return unknown_query.clone();
    };
    let ignored = matches!(object.get("policy"), Some(JsonValue::String(policy)) if policy == "ignore");

    match object.get("reason") {
        Some(reason) if ignored => {
            JsonValue::Object(JsonObject::from_members([("ignore", reason.clone())]))
        }
        _ => object.get("policy").cloned().unwrap_or(JsonValue::Null),
    }
}

/// The maturity without its provenance.
pub(crate) fn maturity_value(maturity: &JsonValue) -> JsonValue {
    without_provenance(maturity)
}

/// A response as its status, shape, body type, non-JSON media and header names.
pub(crate) fn response_value(response: &JsonValue) -> JsonValue {
    let Some(response) = object_of(Some(response)) else {
        return JsonValue::Object(JsonObject::new());
    };
    let mut members = JsonObject::new();

    for name in ["status", "shape"] {
        if let Some(value) = response.get(name) {
            members.insert(name.to_owned(), value.clone());
        }
    }

    if let Some(body) = response.get("body") {
        members.insert("body".to_owned(), JsonValue::text(&type_text(Some(body))));
    }

    match response.get("media") {
        Some(JsonValue::String(media)) if media == JSON_MEDIA => {}
        Some(media) => {
            members.insert("media".to_owned(), media.clone());
        }
        None => {}
    }

    let headers = items_of(response.get("headers"));

    if !headers.is_empty() {
        let names: Vec<JsonValue> = headers
            .iter()
            .filter_map(|header| object_of(Some(header)).and_then(|each| each.get("name")))
            .cloned()
            .collect();

        members.insert("headers".to_owned(), JsonValue::Array(names));
    }

    JsonValue::Object(members)
}

/// Whether `media` is the JSON media type, which the view leaves unsaid.
pub(crate) fn is_json_media(media: Option<&JsonValue>) -> bool {
    matches!(media, Some(JsonValue::String(text)) if text == JSON_MEDIA)
}

/// The `csrf` member as the grammar writes it.
pub(crate) fn csrf_value(_csrf: &JsonValue) -> Result<JsonValue, CliError> {
    Err(not_ported_yet("csrfValue"))
}

/// The `idempotency` member as the grammar writes it.
pub(crate) fn idempotency_value(_idempotency: &JsonValue) -> Result<JsonValue, CliError> {
    Err(not_ported_yet("idempotencyValue"))
}

/// The `concurrency` member as the grammar writes it.
pub(crate) fn concurrency_value(_concurrency: &JsonValue) -> Result<JsonValue, CliError> {
    Err(not_ported_yet("concurrencyValue"))
}

/// The `paging` member as the grammar writes it.
pub(crate) fn paging_value(_paging: &JsonValue) -> Result<JsonValue, CliError> {
    Err(not_ported_yet("pagingValue"))
}

/// The `deprecated` member as the grammar writes it.
pub(crate) fn deprecated_value(_deprecated: &JsonValue) -> Result<JsonValue, CliError> {
    Err(not_ported_yet("deprecatedValue"))
}

/// Whether the subject of a requirement is the member id by default.
pub(crate) fn subject_defaulted(_requirement: &JsonValue) -> Result<bool, CliError> {
    Err(not_ported_yet("subjectDefaulted"))
}

/// A requirement as the grammar writes it.
pub(crate) fn requirement_value(_requirement: &JsonValue) -> Result<JsonValue, CliError> {
    Err(not_ported_yet("requirementValue"))
}

/// A value source as the grammar writes it: `path.taskId`, `host`, `address/24`, `resolver`.
pub(crate) fn source_text(_source: &JsonValue) -> Result<String, CliError> {
    Err(not_ported_yet("sourceText"))
}
