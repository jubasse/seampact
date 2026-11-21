//! What a reader declares it reads, checked against an IR document read as untrusted data
//! (ADR 0005 sections 2 and 3).

use seampact_json::{JsonNumber, JsonObject, JsonValue, stringify_json};

/// What a reader declares it reads: the `irVersion` values, the exact `irRevision`, and the
/// declaration kinds and must-understand features it supports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IrSupport<'support> {
    /// The `irVersion` values the reader reads.
    pub ir_versions: &'support [i64],
    /// The exact `irRevision` the reader was built for.
    pub ir_revision: i64,
    /// The declaration kinds the reader supports.
    pub kinds: &'support [&'support str],
    /// The features the reader supports.
    pub features: &'support [&'support str],
}

/// Why a document is not one a reader reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrSupportCode {
    /// `ir.version.unsupported`.
    VersionUnsupported,
    /// `ir.revision.mismatch`.
    RevisionMismatch,
    /// `ir.kind.unsupported`.
    KindUnsupported,
    /// `ir.feature.unsupported`.
    FeatureUnsupported,
    /// `ir.support.malformed`.
    SupportMalformed,
}

impl IrSupportCode {
    /// The code as the TypeScript writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::VersionUnsupported => "ir.version.unsupported",
            Self::RevisionMismatch => "ir.revision.mismatch",
            Self::KindUnsupported => "ir.kind.unsupported",
            Self::FeatureUnsupported => "ir.feature.unsupported",
            Self::SupportMalformed => "ir.support.malformed",
        }
    }
}

/// A value a mismatch shows: a string or a number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrSupportValue {
    /// A string, or the JSON text of another value.
    Text(String),
    /// A number.
    Number(JsonNumber),
}

/// One unsupported member of a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrSupportMismatch {
    /// The mismatch's code.
    pub code: IrSupportCode,
    /// A JSON Pointer into the IR.
    pub member: String,
    /// The value found; for `ir.support.malformed`, the JSON type found.
    pub value: IrSupportValue,
    /// What the reader supports.
    pub expected: Vec<IrSupportValue>,
    /// The operation id, for a per-operation kind or feature.
    pub operation: Option<String>,
    /// The message.
    pub message: String,
}

/// One named mismatch per unsupported `irVersion`, different `irRevision`, unknown kind or unknown
/// feature, top level and per operation. An unsupported `irVersion` is returned alone; a list
/// that is missing or not an array is named, never read as empty.
#[must_use]
pub fn check_ir_support(ir: &JsonValue, support: &IrSupport<'_>) -> Vec<IrSupportMismatch> {
    let empty = JsonObject::new();
    let document = match ir {
        JsonValue::Object(object) => object,
        _ => &empty,
    };
    let version = document.get("irVersion");
    let version_supported = matches!(version, Some(JsonValue::Number(number))
        if support.ir_versions.iter().any(|supported| is_integer(number, *supported)));

    if !version_supported {
        return vec![version_mismatch(version, support)];
    }

    let mut mismatches = Vec::new();

    if !matches!(document.get("irRevision"), Some(JsonValue::Number(number))
        if is_integer(number, support.ir_revision))
    {
        mismatches.push(revision_mismatch(document.get("irRevision"), support));
    }

    let kinds = list_of(document.get("kinds"), "/kinds", None, &mut mismatches);

    unknown_in(
        kinds,
        support.kinds,
        UnknownKind::Kind,
        "/kinds",
        None,
        &mut mismatches,
    );

    let features = list_of(document.get("features"), "/features", None, &mut mismatches);

    unknown_in(
        features,
        support.features,
        UnknownKind::Feature,
        "/features",
        None,
        &mut mismatches,
    );

    let operations = list_of(
        document.get("operations"),
        "/operations",
        None,
        &mut mismatches,
    );

    for (index, entry) in operations.iter().enumerate() {
        check_operation(index, entry, support, &mut mismatches);
    }

    mismatches
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum UnknownKind {
    Kind,
    Feature,
}

fn is_integer(number: &JsonNumber, expected: i64) -> bool {
    number.to_string() == expected.to_string()
}

fn json_type(value: Option<&JsonValue>) -> &'static str {
    match value {
        None => "missing",
        Some(JsonValue::Null) => "null",
        Some(JsonValue::Array(_)) => "array",
        Some(JsonValue::Bool(_)) => "boolean",
        Some(JsonValue::Number(_)) => "number",
        Some(JsonValue::String(_)) => "string",
        Some(JsonValue::Object(_)) => "object",
    }
}

fn shown(value: Option<&JsonValue>) -> IrSupportValue {
    match value {
        Some(JsonValue::String(text)) => IrSupportValue::Text(text.clone()),
        Some(JsonValue::Number(number)) => IrSupportValue::Number(number.clone()),
        Some(other) => IrSupportValue::Text(stringify_json(other)),
        None => IrSupportValue::Text("missing".to_owned()),
    }
}

fn shown_text(value: Option<&JsonValue>) -> String {
    match shown(value) {
        IrSupportValue::Text(text) => text,
        IrSupportValue::Number(number) => number.to_string(),
    }
}

fn texts(values: &[&str]) -> Vec<IrSupportValue> {
    values
        .iter()
        .map(|value| IrSupportValue::Text((*value).to_owned()))
        .collect()
}

fn version_mismatch(version: Option<&JsonValue>, support: &IrSupport<'_>) -> IrSupportMismatch {
    let versions: Vec<String> = support.ir_versions.iter().map(i64::to_string).collect();
    let expected = support
        .ir_versions
        .iter()
        .filter_map(|supported| JsonNumber::from_json_text(&supported.to_string()))
        .map(IrSupportValue::Number)
        .collect();

    IrSupportMismatch {
        code: IrSupportCode::VersionUnsupported,
        member: "/irVersion".to_owned(),
        value: shown(version),
        expected,
        operation: None,
        message: format!(
            "irVersion {} is not one this reader reads ({}).",
            shown_text(version),
            versions.join(", ")
        ),
    }
}

fn revision_mismatch(revision: Option<&JsonValue>, support: &IrSupport<'_>) -> IrSupportMismatch {
    let expected = JsonNumber::from_json_text(&support.ir_revision.to_string())
        .map(IrSupportValue::Number)
        .into_iter()
        .collect();

    IrSupportMismatch {
        code: IrSupportCode::RevisionMismatch,
        member: "/irRevision".to_owned(),
        value: shown(revision),
        expected,
        operation: None,
        message: format!(
            "irRevision {} differs from the revision this reader was built for ({}).",
            shown_text(revision),
            support.ir_revision
        ),
    }
}

// The items of a list; a value that is no array is named and read as empty, as the TypeScript does
// after naming it.
fn list_of<'doc>(
    value: Option<&'doc JsonValue>,
    member: &str,
    operation: Option<&str>,
    mismatches: &mut Vec<IrSupportMismatch>,
) -> &'doc [JsonValue] {
    if let Some(JsonValue::Array(items)) = value {
        return items;
    }

    let found = json_type(value);

    mismatches.push(IrSupportMismatch {
        code: IrSupportCode::SupportMalformed,
        member: member.to_owned(),
        value: IrSupportValue::Text(found.to_owned()),
        expected: texts(&["array"]),
        operation: operation.map(str::to_owned),
        message: format!(
            "{member} is {found}, not an array: this reader cannot check what it supports."
        ),
    });

    &[]
}

fn unknown_in(
    values: &[JsonValue],
    known: &[&str],
    what: UnknownKind,
    member: &str,
    operation: Option<&str>,
    mismatches: &mut Vec<IrSupportMismatch>,
) {
    let (code, noun) = match what {
        UnknownKind::Kind => (IrSupportCode::KindUnsupported, "declaration kind"),
        UnknownKind::Feature => (IrSupportCode::FeatureUnsupported, "feature"),
    };

    for (index, value) in values.iter().enumerate() {
        if matches!(value, JsonValue::String(text) if known.contains(&text.as_str())) {
            continue;
        }

        let where_ = operation.map_or_else(String::new, |id| format!(" in operation '{id}'"));

        mismatches.push(IrSupportMismatch {
            code,
            member: format!("{member}/{index}"),
            value: shown(Some(value)),
            expected: texts(known),
            operation: operation.map(str::to_owned),
            message: format!(
                "The {noun} '{}'{where_} is not supported by this reader.",
                shown_text(Some(value))
            ),
        });
    }
}

fn check_operation(
    index: usize,
    entry: &JsonValue,
    support: &IrSupport<'_>,
    mismatches: &mut Vec<IrSupportMismatch>,
) {
    let empty = JsonObject::new();
    let operation = match entry {
        JsonValue::Object(object) => object,
        _ => &empty,
    };
    let id = match operation.get("id") {
        Some(JsonValue::String(text)) => text.clone(),
        _ => format!("#{index}"),
    };
    let kind = operation.get("kind");

    if !matches!(kind, Some(JsonValue::String(text)) if support.kinds.contains(&text.as_str())) {
        mismatches.push(IrSupportMismatch {
            code: IrSupportCode::KindUnsupported,
            member: format!("/operations/{index}/kind"),
            value: shown(kind),
            expected: texts(support.kinds),
            operation: Some(id.clone()),
            message: format!(
                "The declaration kind '{}' of operation '{id}' is not supported by this reader.",
                shown_text(kind)
            ),
        });
    }

    let member = format!("/operations/{index}/features");
    let features = list_of(operation.get("features"), &member, Some(&id), mismatches);

    unknown_in(
        features,
        support.features,
        UnknownKind::Feature,
        &member,
        Some(&id),
        mismatches,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUPPORT: IrSupport<'static> = IrSupport {
        ir_versions: &[1],
        ir_revision: 6,
        kinds: &["httpOperation"],
        features: &[],
    };

    fn document(text: &str) -> JsonValue {
        let parsed: serde_json::Value = serde_json::from_str(text).unwrap();

        JsonValue::try_from(parsed).unwrap()
    }

    fn codes(text: &str) -> Vec<&'static str> {
        check_ir_support(&document(text), &SUPPORT)
            .iter()
            .map(|mismatch| mismatch.code.as_str())
            .collect()
    }

    #[test]
    fn a_supported_document_has_no_mismatch() {
        let text = r#"{"irVersion":1,"irRevision":6,"kinds":["httpOperation"],"features":[],
            "operations":[{"id":"a","kind":"httpOperation","features":[]}]}"#;

        assert_eq!(codes(text), Vec::<&str>::new());
        assert_eq!(
            codes(&text.replace("\"irVersion\":1", "\"irVersion\":1.0")),
            Vec::<&str>::new()
        );
    }

    #[test]
    fn an_unsupported_version_is_returned_alone_with_the_json_text_found() {
        let mismatches = check_ir_support(&document(r#"{"irVersion":"1","kinds":5}"#), &SUPPORT);

        assert_eq!(mismatches.len(), 1);
        assert_eq!(
            mismatches.first().map(|mismatch| mismatch.message.as_str()),
            Some("irVersion 1 is not one this reader reads (1).")
        );

        let missing = check_ir_support(&document("[]"), &SUPPORT);

        assert_eq!(
            missing.first().map(|mismatch| mismatch.value.clone()),
            Some(IrSupportValue::Text("missing".to_owned()))
        );

        let object = check_ir_support(&document(r#"{"irVersion":{"a":[1,null]}}"#), &SUPPORT);

        assert_eq!(
            object.first().map(|mismatch| mismatch.message.as_str()),
            Some(r#"irVersion {"a":[1,null]} is not one this reader reads (1)."#)
        );
    }

    #[test]
    fn lists_that_are_missing_or_not_arrays_are_named_and_the_rest_is_still_checked() {
        assert_eq!(
            codes(
                r#"{"irVersion":1,"irRevision":5,"kinds":{},"operations":[3,{"kind":"x","features":["f"]}]}"#
            ),
            [
                "ir.revision.mismatch",
                "ir.support.malformed",
                "ir.support.malformed",
                "ir.kind.unsupported",
                "ir.support.malformed",
                "ir.kind.unsupported",
                "ir.feature.unsupported",
            ]
        );
    }

    #[test]
    fn an_operation_without_an_id_is_named_by_its_index() {
        let mismatches = check_ir_support(
            &document(
                r#"{"irVersion":1,"irRevision":6,"kinds":[],"features":[],"operations":[{"features":[]}]}"#,
            ),
            &SUPPORT,
        );

        assert_eq!(
            mismatches
                .first()
                .map(|mismatch| (mismatch.operation.as_deref(), mismatch.message.as_str())),
            Some((
                Some("#0"),
                "The declaration kind 'missing' of operation '#0' is not supported by this reader."
            ))
        );
    }
}
