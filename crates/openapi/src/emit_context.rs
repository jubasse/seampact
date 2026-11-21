//! What every mapping module of one document shares: the IR, the options, the refusals, and the
//! components and security schemes the document's operations reference.

use std::collections::VecDeque;

use indexmap::{IndexMap, IndexSet};
use seampact_ir::{ContractIr, Extensions, SchemeId};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, Refusal};

use crate::not_ported::not_ported_yet;
use crate::{EmitterOptions, ExtensionName, ExtensionSelection, OpenApiError, ReasonsOption};

/// The prefix of every `x-seampact-*` extension.
const EXTENSION_PREFIX: &str = "x-seampact-";

/// The prefix of a reference to a `components.schemas` entry.
const COMPONENT_SCHEMA_PREFIX: &str = "#/components/schemas/";

/// A named schema as a document writes it: the shared component, or its strict `.input` twin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SchemaVariant {
    /// The shared component.
    Shared,
    /// The strict input twin.
    Input,
}

/// Writes a component once the operations are done.
pub(crate) type ComponentBuilder<'ir> =
    Box<dyn FnOnce(&mut EmitContext<'ir>) -> Result<JsonObject, OpenApiError> + 'ir>;

/// A component referenced and the function that writes it.
pub(crate) struct ComponentRequest<'ir> {
    /// The `components.schemas` key.
    pub(crate) key: String,
    /// Writes the component.
    pub(crate) build: ComponentBuilder<'ir>,
}

/// The state of one document being written.
pub(crate) struct EmitContext<'ir> {
    /// The IR of the api.
    pub(crate) ir: &'ir ContractIr,
    /// The emitter options.
    pub(crate) options: &'ir EmitterOptions,
    /// The refusals so far, in emit order.
    pub(crate) refusals: Vec<Refusal>,
    /// The `components.schemas` keys referenced so far.
    pub(crate) schema_components: IndexSet<String>,
    /// Components referenced but not written yet.
    pub(crate) pending_components: VecDeque<ComponentRequest<'ir>>,
    /// The security schemes the operations name.
    pub(crate) security_schemes: IndexSet<SchemeId>,
    /// The format each error code component is written in; one document holds one body per code.
    pub(crate) error_code_formats: IndexMap<String, String>,
}

/// An empty context for one document of `ir`.
pub(crate) fn create_emit_context<'ir>(
    ir: &'ir ContractIr,
    options: &'ir EmitterOptions,
) -> EmitContext<'ir> {
    EmitContext {
        ir,
        options,
        refusals: Vec::new(),
        schema_components: IndexSet::new(),
        pending_components: VecDeque::new(),
        security_schemes: IndexSet::new(),
        error_code_formats: IndexMap::new(),
    }
}

/// The reference to a component, queuing it to be written the first time it is referenced.
pub(crate) fn reference_component<'ir>(
    context: &mut EmitContext<'ir>,
    request: ComponentRequest<'ir>,
) -> JsonObject {
    let reference = format!("{COMPONENT_SCHEMA_PREFIX}{}", request.key);

    if context.schema_components.insert(request.key.clone()) {
        context.pending_components.push_back(request);
    }

    let mut object = JsonObject::new();

    object.insert("$ref".to_owned(), JsonValue::String(reference));

    object
}

/// Writes the extension `name` into `target` when the options keep it.
pub(crate) fn write_extension(
    context: &EmitContext<'_>,
    target: &mut JsonObject,
    name: &ExtensionName,
    value: JsonValue,
) {
    if !is_extension_selected(&context.options.extensions, name) {
        return;
    }

    target.insert(format!("{EXTENSION_PREFIX}{}", name.as_str()), value);
}

/// Whether a selection keeps the extension `name`.
pub(crate) fn is_extension_selected(selection: &ExtensionSelection, name: &ExtensionName) -> bool {
    match selection {
        ExtensionSelection::None => false,
        ExtensionSelection::All => true,
        ExtensionSelection::Named(names) => names.contains(name),
    }
}

/// A reason as an extension writes it: the text, or `true` under `reasons: omit`, so the member
/// keeps its meaning.
pub(crate) fn reason_value(context: &EmitContext<'_>, reason: &str) -> JsonValue {
    match context.options.reasons {
        ReasonsOption::Omit => JsonValue::Bool(true),
        ReasonsOption::Include => JsonValue::String(reason.to_owned()),
    }
}

/// A reason member that is not the whole meaning of its object, left out under `reasons: omit`.
pub(crate) fn optional_reason<'reason>(
    context: &EmitContext<'_>,
    reason: Option<&'reason str>,
) -> Option<&'reason str> {
    match context.options.reasons {
        ReasonsOption::Omit => None,
        ReasonsOption::Include => reason,
    }
}

/// Writes the consumer extension keys of an element as `x-<prefix>-<key>`.
pub(crate) fn write_consumer_extensions(target: &mut JsonObject, extensions: &Extensions) {
    for (prefix, keys) in extensions {
        for (key, value) in keys {
            target.insert(format!("x-{prefix}-{key}"), value.clone());
        }
    }
}

/// Records the refusal of an open-enum value the emitter must act on and does not know.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub(crate) fn refuse_unknown(
    _context: &mut EmitContext<'_>,
    _location: &IrLocation,
    _value: &str,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("refuseUnknown"))
}

/// Records the refusal of a form the emitter does not write yet.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub(crate) fn refuse_not_emitted(
    _context: &mut EmitContext<'_>,
    _form: &str,
    _description: &str,
    _location: &IrLocation,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("refuseNotEmitted"))
}

/// Records the refusal of an IR that breaks a rule the compiler guarantees.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub(crate) fn refuse_inconsistent(
    _context: &mut EmitContext<'_>,
    _code: &str,
    _description: &str,
    _location: &IrLocation,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("refuseInconsistent"))
}

/// An IR of the golden fixtures, for the tests of the modules that need a context.
#[cfg(test)]
pub(crate) fn fixture_ir() -> Result<ContractIr, Box<dyn std::error::Error>> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/expected/golden/every-default/contract/ir/ledger.json"
    );

    Ok(ContractIr::from_json_text(&std::fs::read_to_string(path)?)?)
}

#[cfg(test)]
mod tests {
    use seampact_ir::{ExtensionKey, ExtensionPrefix, IrMap};

    use super::*;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn build_nothing<'ir>(key: &str) -> ComponentRequest<'ir> {
        ComponentRequest {
            key: key.to_owned(),
            build: Box::new(|_| Ok(JsonObject::new())),
        }
    }

    #[test]
    fn a_component_is_queued_once_and_referenced_by_its_key() -> TestResult {
        let ir = fixture_ir()?;
        let options = EmitterOptions::default();
        let mut context = create_emit_context(&ir, &options);

        let first = reference_component(&mut context, build_nothing("Task"));
        let second = reference_component(&mut context, build_nothing("Task"));

        assert_eq!(first, second);
        assert_eq!(
            first.get("$ref"),
            Some(&JsonValue::String("#/components/schemas/Task".to_owned()))
        );
        assert_eq!(context.pending_components.len(), 1);

        Ok(())
    }

    #[test]
    fn an_extension_is_written_only_when_the_selection_keeps_it() -> TestResult {
        let ir = fixture_ir()?;
        let named = ExtensionName::new("api");
        let other = ExtensionName::new("format");
        let cases = [
            (ExtensionSelection::All, true),
            (ExtensionSelection::None, false),
            (ExtensionSelection::Named(vec![named.clone()]), true),
            (ExtensionSelection::Named(vec![other]), false),
        ];

        for (selection, kept) in cases {
            let options = EmitterOptions {
                extensions: selection.clone(),
                ..EmitterOptions::default()
            };
            let context = create_emit_context(&ir, &options);
            let mut target = JsonObject::new();

            write_extension(&context, &mut target, &named, JsonValue::Bool(true));

            assert_eq!(
                target.contains_key("x-seampact-api"),
                kept,
                "selection {selection:?}"
            );
        }

        Ok(())
    }

    #[test]
    fn reasons_are_replaced_by_true_or_dropped_under_omit() -> TestResult {
        let ir = fixture_ir()?;
        let options = EmitterOptions {
            reasons: ReasonsOption::Omit,
            ..EmitterOptions::default()
        };
        let omitting = create_emit_context(&ir, &options);
        let including_options = EmitterOptions::default();
        let including = create_emit_context(&ir, &including_options);

        assert_eq!(reason_value(&omitting, "why"), JsonValue::Bool(true));
        assert_eq!(optional_reason(&omitting, Some("why")), None);
        assert_eq!(
            reason_value(&including, "why"),
            JsonValue::String("why".to_owned())
        );
        assert_eq!(optional_reason(&including, Some("why")), Some("why"));

        Ok(())
    }

    #[test]
    fn consumer_extensions_follow_the_ir_key_order() {
        let mut keys = IrMap::new();

        keys.insert(ExtensionKey::new("b".to_owned()), JsonValue::Null);
        keys.insert(ExtensionKey::new("10".to_owned()), JsonValue::Null);
        keys.insert(ExtensionKey::new("9".to_owned()), JsonValue::Null);

        let mut extensions = Extensions::new();

        extensions.insert(ExtensionPrefix::new("acme".to_owned()), keys);

        let mut target = JsonObject::new();

        write_consumer_extensions(&mut target, &extensions);

        let written: Vec<&str> = target.keys().map(String::as_str).collect();

        assert_eq!(written, ["x-acme-9", "x-acme-10", "x-acme-b"]);
    }
}
