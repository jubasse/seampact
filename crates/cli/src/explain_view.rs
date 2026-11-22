//! The text `seampact explain` prints: one operation of the IR as YAML in the grammar's words,
//! each line commented with the derivation that produced it and the file and line that caused it.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_ir::{ContractIr, Operation, to_json_value};
use seampact_json::{JsonNumber, JsonObject, JsonValue, items_of, js_text_of, object_of};
use seampact_span::Location;

use crate::CliError;
use crate::document_order::in_document_order;
use crate::explain_flow::{flow, flow_of, object_of_present, type_text};
use crate::explain_not_shown::not_shown_line;
use crate::explain_origin::provenance;
use crate::explain_values::{
    concurrency_value, csrf_value, deprecated_value, idempotency_value, is_json_media,
    maturity_value, paging_value, requirement_value, response_value, source_text,
    subject_defaulted, unknown_query_value, without_provenance,
};

/// The column a comment starts at; a longer line takes its comment two spaces after it.
const COMMENT_COLUMN: usize = 49;

const MIN_COMMENT_GAP: usize = 2;

const DEFAULTED_SUBJECT: &str = "the subject defaults to the member id";

const NOT_IN_REGISTRY: &str = "not in the error registry";

/// One line of the view and the comment that follows it.
struct ViewLine {
    text: String,
    comment: Option<String>,
}

impl ViewLine {
    fn plain(text: String) -> Self {
        Self {
            text,
            comment: None,
        }
    }

    fn commented(text: String, comment: String) -> Self {
        Self {
            text,
            comment: Some(comment),
        }
    }

    fn written(&self) -> String {
        let Some(comment) = self
            .comment
            .as_deref()
            .filter(|comment| !comment.is_empty())
        else {
            return self.text.clone();
        };
        let width = self.text.encode_utf16().count();
        let padding = COMMENT_COLUMN.saturating_sub(width).max(MIN_COMMENT_GAP);

        format!("{}{}# {comment}", self.text, " ".repeat(padding))
    }
}

/// The provenance comment of a value, read through the file and line of the declarations.
struct Where<'locations> {
    locations: &'locations IndexMap<String, Location>,
}

impl Where<'_> {
    fn of(&self, value: &JsonValue) -> String {
        provenance(value, self.locations)
    }
}

/// `key:` followed by `items`, nothing when there are none.
fn block(key: &str, items: Vec<ViewLine>) -> Vec<ViewLine> {
    if items.is_empty() {
        return items;
    }

    let mut lines = vec![ViewLine::plain(format!("{key}:"))];

    lines.extend(items);

    lines
}

/// `key: <value>` for a member that is present, its text from `render`.
fn member_line(
    key: &str,
    value: Option<&JsonValue>,
    render: impl FnOnce(&JsonValue) -> JsonValue,
    provenance_of: &Where<'_>,
) -> Vec<ViewLine> {
    let Some(value) = value else {
        return Vec::new();
    };

    vec![ViewLine::commented(
        format!("{key}: {}", flow(&render(value))),
        provenance_of.of(value),
    )]
}

fn identity_lines(access: &JsonObject, comment: String) -> Vec<ViewLine> {
    vec![
        ViewLine::commented(
            format!("identity: {}", js_text_of(access.get("identity"))),
            comment,
        ),
        ViewLine::plain(format!("schemes: {}", flow_of(access.get("schemes")))),
    ]
}

fn access_lines(access: &JsonValue, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    let comment = provenance_of.of(access);
    let kind = object_of(Some(access)).and_then(|object| match object.get("kind") {
        Some(JsonValue::String(kind)) => Some((object, kind.as_str())),
        _ => None,
    });

    match kind {
        Some((object, "identity")) if object.contains_key("schemes") => {
            identity_lines(object, comment)
        }
        Some((object, "optional")) if object.contains_key("onRefused") => {
            let mut lines = identity_lines(object, comment);
            let optional = object_of_present([
                ("optionalAuth", object.get("reason")),
                ("onRefused", object.get("onRefused")),
            ]);

            lines.push(ViewLine::plain(format!("access: {}", flow(&optional))));

            lines
        }
        Some((object, "public")) if object.contains_key("reason") => {
            let public = object_of_present([("public", object.get("reason"))]);

            vec![ViewLine::commented(
                format!("access: {}", flow(&public)),
                comment,
            )]
        }
        _ => vec![ViewLine::commented(
            format!("access: {}", flow(&without_provenance(access))),
            comment,
        )],
    }
}

fn input_lines(operation: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    let Some(input) = operation.get("input") else {
        return Vec::new();
    };
    let input_members = object_of(Some(input));
    let member = |name: &str| input_members.and_then(|object| object.get(name));
    let mut lines = vec![ViewLine::commented(
        format!("input: {}", type_text(member("schema"))),
        provenance_of.of(input),
    )];

    if !is_json_media(member("media")) {
        lines.push(ViewLine::plain(format!(
            "inputMedia: {}",
            flow_of(member("media"))
        )));
    }

    lines.push(ViewLine::plain(format!(
        "bodyLimitBytes: {}",
        js_text_of(member("bodyLimitBytes"))
    )));

    lines
}

fn param_lines(operation: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    let params = object_of(operation.get("params"));
    let mut lines = Vec::new();

    for place in ["path", "query", "header"] {
        for param in items_of(params.and_then(|params| params.get(place))) {
            let member = |name: &str| object_of(Some(param)).and_then(|object| object.get(name));
            let mut typed = JsonObject::new();

            typed.insert(
                "type".to_owned(),
                JsonValue::text(&type_text(member("type"))),
            );

            if let Some(required) = member("required") {
                typed.insert("required".to_owned(), required.clone());
            }

            lines.push(ViewLine::commented(
                format!(
                    "  {place}.{}: {}",
                    js_text_of(member("name")),
                    flow(&JsonValue::Object(typed))
                ),
                provenance_of.of(param),
            ));
        }
    }

    lines
}

fn error_lines(
    ir: &ContractIr,
    operation: &JsonObject,
    provenance_of: &Where<'_>,
) -> Vec<ViewLine> {
    let mut errors: Vec<(usize, Option<i64>, &JsonValue)> = items_of(operation.get("errors"))
        .iter()
        .enumerate()
        .map(|(index, error)| {
            let status = match object_of(Some(error)).and_then(|each| each.get("code")) {
                Some(JsonValue::String(code)) => ir
                    .errors
                    .get(code.as_str())
                    .map(|declared| declared.http.status),
                _ => None,
            };

            (index, status, error)
        })
        .collect();

    // Equal statuses keep the IR's order.
    errors.sort_by_key(|(index, status, _)| (status.unwrap_or(0), *index));

    errors
        .into_iter()
        .map(|(_, status, error)| {
            let mut members = JsonObject::new();

            members.insert(
                "status".to_owned(),
                status.map_or_else(
                    || JsonValue::text(NOT_IN_REGISTRY),
                    |status| JsonValue::Number(JsonNumber::from_i64(status)),
                ),
            );

            if let Some(code) = object_of(Some(error)).and_then(|each| each.get("code")) {
                members.insert("code".to_owned(), code.clone());
            }

            ViewLine::commented(
                format!("  - {}", flow(&JsonValue::Object(members))),
                provenance_of.of(error),
            )
        })
        .collect()
}

fn scope_lines(operation: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    items_of(operation.get("scopes"))
        .iter()
        .map(|scope| {
            let member = |name: &str| object_of(Some(scope)).and_then(|object| object.get(name));
            let source = source_text(member("source"));

            ViewLine::commented(
                format!("  {}: {source}", js_text_of(member("scope"))),
                provenance_of.of(scope),
            )
        })
        .collect()
}

fn requirement_lines(operation: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    items_of(operation.get("requires"))
        .iter()
        .map(|requirement| {
            let value = requirement_value(requirement);
            let mut comment = provenance_of.of(requirement);

            if subject_defaulted(requirement) {
                if !comment.is_empty() {
                    comment.push_str("; ");
                }

                comment.push_str(DEFAULTED_SUBJECT);
            }

            ViewLine::commented(format!("  - {}", flow(&value)), comment)
        })
        .collect()
}

fn field_right_lines(operation: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    items_of(operation.get("fieldRights"))
        .iter()
        .map(|field_right| {
            let member =
                |name: &str| object_of(Some(field_right)).and_then(|object| object.get(name));
            let described = object_of_present([
                ("schema", member("schema")),
                ("pointer", member("pointer")),
                ("right", member("right")),
                ("direction", member("direction")),
                ("inputPolicy", member("inputPolicy")),
                ("always", member("always")),
            ]);

            ViewLine::commented(
                format!("  - {}", flow(&described)),
                provenance_of.of(field_right),
            )
        })
        .collect()
}

fn response_lines(operation: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    items_of(operation.get("responses"))
        .iter()
        .map(|response| {
            ViewLine::commented(
                format!("  - {}", flow(&response_value(response))),
                provenance_of.of(response),
            )
        })
        .collect()
}

fn operation_id_comment(operation: &JsonValue, provenance_of: &Where<'_>) -> String {
    let shorthand = object_of(Some(operation))
        .and_then(|members| members.get("op"))
        .map(|op| format!("ops.{}", js_text_of(Some(op))))
        .unwrap_or_default();
    let located = provenance_of.of(operation);
    let parts: Vec<String> = [shorthand, located]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect();

    parts.join(", ")
}

fn identity_member(value: &JsonValue) -> JsonValue {
    value.clone()
}

fn plain_member(value: &JsonValue) -> JsonValue {
    without_provenance(value)
}

fn relay_member(relay: &JsonValue) -> JsonValue {
    let member = |name: &str| object_of(Some(relay)).and_then(|object| object.get(name));

    JsonValue::text(&format!(
        "{}.{}",
        js_text_of(member("api")),
        js_text_of(member("id"))
    ))
}

/// The lines from `csrf` to `relays`: the members that carry rules and their provenance.
fn member_lines(ir: &ContractIr, members: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    let get = |name: &str| members.get(name);
    let mut lines = Vec::new();

    lines.extend(member_line("csrf", get("csrf"), csrf_value, provenance_of));
    lines.extend(block("scopes", scope_lines(members, provenance_of)));
    lines.extend(block("requires", requirement_lines(members, provenance_of)));
    lines.extend(block("params", param_lines(members, provenance_of)));
    lines.extend(member_line(
        "unknownQuery",
        get("unknownQuery"),
        unknown_query_value,
        provenance_of,
    ));
    lines.extend(input_lines(members, provenance_of));
    lines.extend(member_line(
        "idempotency",
        get("idempotency"),
        idempotency_value,
        provenance_of,
    ));
    lines.extend(member_line(
        "concurrency",
        get("concurrency"),
        concurrency_value,
        provenance_of,
    ));
    lines.extend(block("responses", response_lines(members, provenance_of)));
    lines.extend(block("errors", error_lines(ir, members, provenance_of)));
    lines.extend(block(
        "fieldRights",
        field_right_lines(members, provenance_of),
    ));
    lines.extend(member_line(
        "cache",
        get("cache"),
        plain_member,
        provenance_of,
    ));
    lines.extend(member_line(
        "paging",
        get("paging"),
        paging_value,
        provenance_of,
    ));
    lines.extend(member_line(
        "filteredBy",
        get("filteredBy"),
        identity_member,
        provenance_of,
    ));
    lines.extend(member_line(
        "owner",
        get("owner"),
        plain_member,
        provenance_of,
    ));
    lines.extend(member_line(
        "degradable",
        get("degradable"),
        plain_member,
        provenance_of,
    ));
    lines.extend(member_line(
        "budgetMs",
        get("budgetMs"),
        identity_member,
        provenance_of,
    ));
    lines.extend(member_line(
        "deadlineHeader",
        get("deadlineHeader"),
        identity_member,
        provenance_of,
    ));
    lines.extend(member_line(
        "deprecated",
        get("deprecated"),
        deprecated_value,
        provenance_of,
    ));
    lines.extend(member_line(
        "relays",
        get("relays"),
        relay_member,
        provenance_of,
    ));

    lines
}

/// The lines from `upstream` to the members the view leaves out.
fn tail_lines(members: &JsonObject, provenance_of: &Where<'_>) -> Vec<ViewLine> {
    let get = |name: &str| members.get(name);
    let mut lines = Vec::new();

    let upstream = items_of(get("upstream"));

    if !upstream.is_empty() {
        lines.push(ViewLine::plain(format!(
            "upstream: {}",
            flow(&JsonValue::Array(upstream.to_vec()))
        )));
    }

    if let Some(maturity) = get("maturity") {
        lines.push(ViewLine::commented(
            format!("maturity: {}", flow(&maturity_value(maturity))),
            provenance_of.of(maturity),
        ));
    }

    if matches!(get("internal"), Some(JsonValue::Bool(true))) {
        lines.push(ViewLine::plain("internal: true".to_owned()));
    }

    lines.push(ViewLine::plain(format!(
        "format: {}",
        js_text_of(get("format"))
    )));

    let tags = items_of(get("tags"));

    if !tags.is_empty() {
        lines.push(ViewLine::plain(format!(
            "tags: {}",
            flow(&JsonValue::Array(tags.to_vec()))
        )));
    }

    lines.extend(not_shown_line(members).map(ViewLine::plain));

    lines
}

/// The view of `operation` of `ir`: the lines of its members, then what the view leaves out.
///
/// # Errors
///
/// [`CliError::Internal`] when the operation does not encode.
pub(crate) fn explain_operation_text(
    ir: &ContractIr,
    operation: &Operation,
    locations: &IndexMap<String, Location>,
) -> Result<String, CliError> {
    let operation_value = to_json_value(operation)
        .map_err(|error| error.to_string())
        .and_then(|value| in_document_order(&value))
        .map_err(InternalError::new)?;
    let JsonValue::Object(members) = &operation_value else {
        return Err(InternalError::new("an operation that is not a mapping").into());
    };
    let provenance_of = &Where { locations };
    let get = |name: &str| members.get(name);
    let text_of = |name: &str| js_text_of(get(name));
    let mut lines = vec![
        ViewLine::plain(format!(
            "# seampact explain {}.{}",
            ir.api.id,
            text_of("id")
        )),
        ViewLine::commented(
            format!("operationId: {}", text_of("id")),
            operation_id_comment(&operation_value, provenance_of),
        ),
        ViewLine::plain(format!("surface: {}", text_of("surface"))),
        ViewLine::plain(format!("method: {}", text_of("method"))),
        ViewLine::plain(format!("path: {}", text_of("path"))),
    ];

    if let Some(access) = get("access") {
        lines.extend(access_lines(access, provenance_of));
    }

    lines.extend(member_lines(ir, members, provenance_of));

    lines.extend(tail_lines(members, provenance_of));

    let written: Vec<String> = lines.iter().map(ViewLine::written).collect();

    Ok(format!("{}\n", written.join("\n")))
}
