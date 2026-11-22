//! The rules of the body proofs of an operation input.

use std::collections::HashSet;

use seampact_json::{JsonObject, JsonValue, is_text, items_of, js_text_of, object_of, text_of};

use super::json_members::is_listed;
use super::open_values::is_known;
use super::partitions::{
    FIELD_MEDIA, KNOWN_SCHEMA_KINDS, KNOWN_TYPE_USE_KINDS, OBJECT_SCHEMA_KINDS,
};
use super::violation::{IrInvariantId, Violations};
use crate::IrError;

// The schema entry a `ref` use names, if the document has it.
fn ref_target_of<'entries>(
    type_use: &JsonObject,
    schema_entries: &'entries JsonObject,
) -> Option<&'entries JsonValue> {
    if !is_text(type_use.get("kind"), "ref") {
        return None;
    }

    schema_entries.get(text_of(type_use.get("schema"))?)
}

fn proofs_of(input: &JsonObject) -> &[JsonValue] {
    items_of(input.get("proofs"))
}

/// The input of a body proof is a `ref` use of an object schema. An unknown use or schema kind is
/// the reader's to name, and a missing schema is `ir.ref.resolves`'.
pub(super) fn check_proof_input(
    input: &JsonObject,
    pointer: &str,
    schema_entries: &JsonObject,
    out: &mut Violations,
) {
    if proofs_of(input).is_empty() {
        return;
    }

    let empty = JsonObject::new();
    let type_use = object_of(input.get("schema")).unwrap_or(&empty);
    let message = "An input with body proofs is a 'ref' use of an object schema";
    let at = format!("{pointer}/schema");

    if !is_text(type_use.get("kind"), "ref") {
        if is_listed(type_use.get("kind"), KNOWN_TYPE_USE_KINDS) {
            let kind = js_text_of(type_use.get("kind"));

            out.fail(
                IrInvariantId::InputProofInput,
                &at,
                format!("{message}, not a '{kind}' use."),
            );
        }

        return;
    }

    let Some(target) = object_of(ref_target_of(type_use, schema_entries)) else {
        return;
    };
    let kind = js_text_of(target.get("kind"));

    if KNOWN_SCHEMA_KINDS.contains(&kind.as_str()) && !OBJECT_SCHEMA_KINDS.contains(&kind.as_str())
    {
        let schema = js_text_of(type_use.get("schema"));

        out.fail(
            IrInvariantId::InputProofInput,
            &at,
            format!("{message}: '{schema}' is a '{kind}' schema."),
        );
    }
}

// The names a body already carries: the properties of the input's object schema and its form
// fields.
fn body_names_of<'doc>(
    input: &'doc JsonObject,
    schema_entries: &'doc JsonObject,
) -> HashSet<&'doc str> {
    let empty = JsonObject::new();
    let type_use = object_of(input.get("schema")).unwrap_or(&empty);
    let target = object_of(ref_target_of(type_use, schema_entries));
    let properties = items_of(target.and_then(|target| target.get("properties")));
    let fields = items_of(input.get("fields"));

    properties
        .iter()
        .chain(fields)
        .filter_map(|member| text_of(object_of(Some(member))?.get("name")))
        .collect()
}

/// A proof is identified by its name: one element per name, and no name the body already carries.
pub(super) fn check_proof_names(
    input: &JsonObject,
    pointer: &str,
    schema_entries: &JsonObject,
    out: &mut Violations,
) {
    let taken = body_names_of(input, schema_entries);
    let mut seen: HashSet<&str> = HashSet::new();

    for (index, proof) in proofs_of(input).iter().enumerate() {
        let Some(name) = object_of(Some(proof)).and_then(|proof| text_of(proof.get("name"))) else {
            continue;
        };

        if seen.contains(name) || taken.contains(name) {
            out.fail(
                IrInvariantId::InputProofName,
                &format!("{pointer}/proofs/{index}"),
                format!(
                    "The body proof '{name}' repeats a proof, a property of the input schema or a form field."
                ),
            );
        }

        seen.insert(name);
    }
}

/// A body proof is sent as the input's other fields are: with a wire form in a form or multipart
/// body, none in a JSON one, and never a file one. An unknown media type is the reader's to name.
///
/// # Errors
///
/// [`IrError::BrokenSchemas`] when the embedded schemas lack the open enum.
pub(super) fn check_proof_wires(
    input: &JsonObject,
    pointer: &str,
    out: &mut Violations,
) -> Result<(), IrError> {
    let media_known = is_known("OperationInput", "media", input.get("media"))?;
    let field_media = is_listed(input.get("media"), FIELD_MEDIA);

    for (index, proof) in proofs_of(input).iter().enumerate() {
        let Some(proof) = object_of(Some(proof)) else {
            continue;
        };
        let at = format!("{pointer}/proofs/{index}");

        if is_text(
            object_of(proof.get("wire")).and_then(|wire| wire.get("kind")),
            "file",
        ) {
            out.fail(
                IrInvariantId::InputProofWire,
                &at,
                "A body proof's wire kind is not 'file'.".to_owned(),
            );
        }

        if media_known && proof.contains_key("wire") != field_media {
            let media = js_text_of(input.get("media"));

            out.fail(
                IrInvariantId::InputProofWire,
                &at,
                format!(
                    "A body proof has 'wire' if and only if the input is form or multipart ('{media}')."
                ),
            );
        }
    }

    Ok(())
}
