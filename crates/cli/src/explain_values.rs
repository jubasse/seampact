//! The value each member of an operation shows as in `seampact explain`.

use seampact_json::{JsonObject, JsonValue, is_text, items_of, js_text_of, object_of};

use crate::explain_flow::{object_of_present, type_text};

const JSON_MEDIA: &str = "application/json";

/// The members of a requirement the grammar writes apart or not at all.
const REQUIREMENT_SET_APART: [&str; 5] = ["kind", "entry", "subject", "origin", "derivedFrom"];

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
    let ignored =
        matches!(object.get("policy"), Some(JsonValue::String(policy)) if policy == "ignore");

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
pub(crate) fn csrf_value(csrf: &JsonValue) -> JsonValue {
    let object = object_of(Some(csrf));

    if let Some(object) = object {
        if is_text(object.get("kind"), "derived")
            && let Some(header) = object.get("header")
        {
            return header.clone();
        }

        if is_text(object.get("kind"), "exempt")
            && let Some(reason) = object.get("reason")
        {
            return JsonValue::Object(JsonObject::from_members([("exempt", reason.clone())]));
        }
    }

    without_provenance(csrf)
}

/// The `idempotency` member as the grammar writes it.
pub(crate) fn idempotency_value(idempotency: &JsonValue) -> JsonValue {
    let object = object_of(Some(idempotency));

    if let Some(object) = object {
        if is_text(object.get("kind"), "derived") && object.contains_key("header") {
            return object_of_present(
                [
                    "header",
                    "required",
                    "replayHeader",
                    "lifetimeMs",
                    "enforce",
                ]
                .map(|name| (name, object.get(name))),
            );
        }

        if is_text(object.get("kind"), "exempt")
            && let Some(reason) = object.get("reason")
        {
            return JsonValue::Object(JsonObject::from_members([("exempt", reason.clone())]));
        }
    }

    without_provenance(idempotency)
}

/// The `concurrency` member as the grammar writes it.
pub(crate) fn concurrency_value(concurrency: &JsonValue) -> JsonValue {
    let object = object_of(Some(concurrency));
    let version = source_text(object.and_then(|each| each.get("version")));

    object_of_present([
        ("version", Some(&JsonValue::text(&version))),
        ("field", object.and_then(|each| each.get("field"))),
    ])
}

/// The `paging` member as the grammar writes it: its sort keys, when any, by key name and last.
pub(crate) fn paging_value(paging: &JsonValue) -> JsonValue {
    let mut rest = without_provenance_object(paging);
    let sort_keys = rest.remove("sortKeys");

    if let Some(JsonValue::Array(keys)) = sort_keys
        && !keys.is_empty()
    {
        let names: Vec<JsonValue> = keys.iter().map(sort_key_name).collect();

        rest.insert("sortKeys".to_owned(), JsonValue::Array(names));
    }

    JsonValue::Object(rest)
}

/// The `key` of a sort key that is a mapping, else the sort key itself.
fn sort_key_name(key: &JsonValue) -> JsonValue {
    match key {
        JsonValue::Object(object) => object
            .get("key")
            .cloned()
            .unwrap_or_else(|| JsonValue::text("undefined")),
        other => other.clone(),
    }
}

/// The `deprecated` member as the grammar writes it: its successor, when a mapping, as `api.id`.
pub(crate) fn deprecated_value(deprecated: &JsonValue) -> JsonValue {
    let mut rest = without_provenance_object(deprecated);
    let successor = rest.remove("successor");

    if let Some(JsonValue::Object(successor)) = successor {
        let named = format!(
            "{}.{}",
            js_text_of(successor.get("api")),
            js_text_of(successor.get("id"))
        );

        rest.insert("successor".to_owned(), JsonValue::text(&named));
    }

    JsonValue::Object(rest)
}

/// Whether the subject of a requirement is the member id by default.
pub(crate) fn subject_defaulted(requirement: &JsonValue) -> bool {
    let subject = object_of(Some(requirement)).and_then(|object| object.get("subject"));

    matches!(
        object_of(subject).and_then(|each| each.get("defaulted")),
        Some(JsonValue::Bool(true))
    )
}

/// A requirement as the grammar writes it: its subject as text, its `kind` first unless a right or
/// a rule.
pub(crate) fn requirement_value(requirement: &JsonValue) -> JsonValue {
    let object = object_of(Some(requirement));
    let member = |name: &str| object.and_then(|each| each.get(name));
    let mut value = JsonObject::new();

    for (name, each) in object.into_iter().flat_map(JsonObject::iter) {
        if !REQUIREMENT_SET_APART.contains(&name.as_str()) {
            value.insert(name.clone(), each.clone());
        }
    }

    if let Some(subject) = object_of(member("subject")) {
        let source = source_text(subject.get("source"));

        value.insert("subject".to_owned(), JsonValue::text(&source));
    }

    if let Some(entry) = member("entry") {
        value.insert("entry".to_owned(), entry.clone());
    }

    let kind = member("kind");

    if is_text(kind, "right") || is_text(kind, "rule") {
        return JsonValue::Object(value);
    }

    let mut with_kind = JsonObject::new();

    if let Some(kind) = kind {
        with_kind.insert("kind".to_owned(), kind.clone());
    }

    for (name, each) in &value {
        with_kind.insert(name.clone(), each.clone());
    }

    JsonValue::Object(with_kind)
}

/// A value source as the grammar writes it: `path.taskId`, `host`, `address/24`, `resolver`.
///
/// An absent source is `undefined`, as `String(undefined)` is.
pub(crate) fn source_text(source: Option<&JsonValue>) -> String {
    let Some(JsonValue::Object(source)) = source else {
        return js_text_of(source);
    };

    if matches!(source.get("resolver"), Some(JsonValue::Bool(true))) {
        return "resolver".to_owned();
    }

    if let Some(JsonValue::String(name)) = source.get("name") {
        return format!("{}.{name}", js_text_of(source.get("in")));
    }

    if let Some(JsonValue::String(field)) = source.get("holderField") {
        return format!("holderField.{field}");
    }

    if let Some(bits @ JsonValue::Number(_)) = source.get("prefixBits") {
        return format!(
            "{}/{}",
            js_text_of(source.get("in")),
            js_text_of(Some(bits))
        );
    }

    js_text_of(source.get("in"))
}

/// [`without_provenance`] as the mapping it always is.
fn without_provenance_object(value: &JsonValue) -> JsonObject {
    let JsonValue::Object(object) = without_provenance(value) else {
        return JsonObject::new();
    };

    object
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::explain_flow::flow;

    fn json(text: &str) -> JsonValue {
        serde_json::from_str(text).unwrap()
    }

    fn flowed(value: &JsonValue) -> String {
        flow(value)
    }

    #[test]
    fn a_source_reads_as_the_grammar_writes_it() {
        for (source, text) in [
            (r#"{"resolver":true,"in":"path"}"#, "resolver"),
            (r#"{"in":"path","name":"taskId"}"#, "path.taskId"),
            (
                r#"{"in":"header","holderField":"owner"}"#,
                "holderField.owner",
            ),
            (r#"{"in":"address","prefixBits":24}"#, "address/24"),
            (r#"{"in":"address","prefixBits":1e21}"#, "address/1e+21"),
            (r#"{"in":"host"}"#, "host"),
            (r"{}", "undefined"),
            (r#""host""#, "host"),
            ("null", "null"),
            ("[1,null,2]", "1,,2"),
        ] {
            assert_eq!(source_text(Some(&json(source))), text, "source {source}");
        }

        assert_eq!(source_text(None), "undefined");
    }

    #[test]
    fn paging_keeps_its_sort_keys_last_and_by_key_name() {
        let paging = json(
            r#"{"sortKeys":[{"key":"createdAt","origin":{}},"id"],"origin":{},"style":"cursor","limit":10}"#,
        );

        assert_eq!(
            flowed(&paging_value(&paging)),
            "{ style: cursor, limit: 10, sortKeys: [createdAt, id] }"
        );
    }

    #[test]
    fn paging_drops_sort_keys_that_are_empty_or_not_a_list() {
        for paging in [
            r#"{"sortKeys":[],"style":"cursor"}"#,
            r#"{"sortKeys":"id","style":"cursor"}"#,
        ] {
            assert_eq!(
                flowed(&paging_value(&json(paging))),
                "{ style: cursor }",
                "paging {paging}"
            );
        }
    }

    #[test]
    fn a_deprecated_successor_reads_as_api_dot_id_and_goes_last() {
        let deprecated = json(
            r#"{"successor":{"api":"v2","id":"getOrder"},"since":"2025-01-01","derivedFrom":[]}"#,
        );

        assert_eq!(
            flowed(&deprecated_value(&deprecated)),
            "{ since: \"2025-01-01\", successor: v2.getOrder }"
        );
        assert_eq!(
            flowed(&deprecated_value(&json(
                r#"{"successor":"x","since":"2025-01-01"}"#
            ))),
            "{ since: \"2025-01-01\" }"
        );
    }

    #[test]
    fn a_requirement_leads_with_its_kind_unless_a_right_or_a_rule() {
        let guard = json(
            r#"{"kind":"guard","entry":"e","origin":{},"subject":{"source":{"in":"path","name":"id"},"defaulted":true},"name":"nm"}"#,
        );
        let right = json(r#"{"kind":"right","right":"r"}"#);

        assert_eq!(
            flowed(&requirement_value(&guard)),
            "{ kind: guard, name: nm, subject: path.id, entry: e }"
        );
        assert_eq!(flowed(&requirement_value(&right)), "{ right: r }");
        assert!(subject_defaulted(&guard));
        assert!(!subject_defaulted(&right));
        assert!(!subject_defaulted(&json(
            r#"{"subject":{"defaulted":"true"}}"#
        )));
    }

    #[test]
    fn csrf_and_idempotency_show_their_header_or_their_exemption() {
        assert_eq!(
            flowed(&csrf_value(&json(
                r#"{"kind":"derived","header":"X-Csrf"}"#
            ))),
            "X-Csrf"
        );
        assert_eq!(
            flowed(&csrf_value(&json(
                r#"{"kind":"exempt","reason":"webhook","origin":{}}"#
            ))),
            "{ exempt: webhook }"
        );
        assert_eq!(
            flowed(&csrf_value(&json(r#"{"kind":"declared","origin":{}}"#))),
            "{ kind: declared }"
        );
        assert_eq!(
            flowed(&idempotency_value(&json(
                r#"{"kind":"derived","header":"Idem","required":true,"lifetimeMs":1000,"origin":{}}"#
            ))),
            "{ header: Idem, required: true, lifetimeMs: 1000 }"
        );
        assert_eq!(
            flowed(&idempotency_value(&json(
                r#"{"kind":"exempt","reason":"safe"}"#
            ))),
            "{ exempt: safe }"
        );
    }

    #[test]
    fn concurrency_names_its_version_source_and_field() {
        let concurrency = json(r#"{"version":{"in":"header","name":"If-Match"},"field":"etag"}"#);

        assert_eq!(
            flowed(&concurrency_value(&concurrency)),
            "{ version: header.If-Match, field: etag }"
        );
    }
}
