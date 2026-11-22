//! The rights an operation requires, as the extensions write them.

use seampact_ir::{KnownRequirementRef, Operation, OperationScope, Requirement, ValueSource};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::ExtensionName;
use crate::emit_context::{
    EmitContext, refuse_unknown, write_consumer_extensions, write_extension,
};
use crate::ir_text::value_source_text;
use crate::json_value::{copy_optional, optional_text, set_defined};

/// The text of a value source, as a JSON string.
fn source_value(
    context: &mut EmitContext<'_>,
    source: &ValueSource,
    location: &IrLocation,
) -> JsonValue {
    JsonValue::text(&value_source_text(context, source, location))
}

/// Writes the principal requirements, bindings, scopes, requirements, field rights and filter of
/// an operation as extensions.
pub(crate) fn write_operation_rights(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    if !operation.principal_requires.is_empty() {
        let fields = operation
            .principal_requires
            .iter()
            .map(|requirement| JsonValue::text(&requirement.field))
            .collect();

        write_extension(
            context,
            target,
            ExtensionName::PrincipalRequires,
            JsonValue::Array(fields),
        );
    }

    if !operation.bindings.is_empty() {
        let bindings = operation
            .bindings
            .iter()
            .enumerate()
            .map(|(index, binding)| {
                let binding_location = location.below(&["bindings", &index.to_string()]);
                let from = source_value(context, &binding.from, &binding_location.below(&["from"]));
                let to = source_value(context, &binding.to, &binding_location.below(&["to"]));

                JsonValue::Object(JsonObject::from_members([("from", from), ("to", to)]))
            })
            .collect();

        write_extension(
            context,
            target,
            ExtensionName::Bindings,
            JsonValue::Array(bindings),
        );
    }

    if !operation.scopes.is_empty() {
        let scopes = operation
            .scopes
            .iter()
            .enumerate()
            .map(|(index, scope)| {
                let scope_location = location.below(&["scopes", &index.to_string()]);

                JsonValue::Object(scope_item(context, scope, &scope_location))
            })
            .collect();

        write_extension(
            context,
            target,
            ExtensionName::Scopes,
            JsonValue::Array(scopes),
        );
    }

    let requirements: Vec<JsonValue> = operation
        .requires
        .iter()
        .enumerate()
        .filter_map(|(index, requirement)| {
            let requirement_location = location.below(&["requires", &index.to_string()]);

            requirement_item(context, requirement, &requirement_location)
        })
        .map(JsonValue::Object)
        .collect();

    if !requirements.is_empty() {
        write_extension(
            context,
            target,
            ExtensionName::Requires,
            JsonValue::Array(requirements),
        );
    }

    if !operation.field_rights.is_empty() {
        let field_rights = operation
            .field_rights
            .iter()
            .enumerate()
            .map(|(index, field_right)| {
                let mut item = JsonObject::from_members([
                    ("schema", JsonValue::text(field_right.schema.as_str())),
                    ("pointer", JsonValue::text(&field_right.pointer)),
                    ("right", JsonValue::text(field_right.right.as_str())),
                ]);
                let subject_location =
                    location.below(&["fieldRights", &index.to_string(), "subject", "source"]);

                set_defined(
                    &mut item,
                    "params",
                    copy_optional(field_right.params.as_ref()),
                );
                set_defined(
                    &mut item,
                    "subject",
                    field_right
                        .subject
                        .as_ref()
                        .map(|subject| source_value(context, &subject.source, &subject_location)),
                );
                item.insert(
                    "direction".to_owned(),
                    JsonValue::text(field_right.direction.as_str()),
                );
                set_defined(
                    &mut item,
                    "input",
                    optional_text(
                        field_right
                            .input_policy
                            .as_ref()
                            .map(|policy| policy.as_str()),
                    ),
                );
                set_defined(
                    &mut item,
                    "always",
                    optional_text(field_right.always.as_ref().map(|always| always.as_str())),
                );

                JsonValue::Object(item)
            })
            .collect();

        write_extension(
            context,
            target,
            ExtensionName::RestrictedTo,
            JsonValue::Array(field_rights),
        );
    }

    if let Some(filtered_by) = &operation.filtered_by {
        write_extension(
            context,
            target,
            ExtensionName::FilteredBy,
            JsonValue::text(filtered_by.as_str()),
        );
    }
}

/// One scope an operation requires, with the consumer extensions of its declaration.
fn scope_item(
    context: &mut EmitContext<'_>,
    scope: &OperationScope,
    location: &IrLocation,
) -> JsonObject {
    let mut item = JsonObject::from_members([
        ("scope", JsonValue::text(scope.scope.as_str())),
        (
            "from",
            source_value(context, &scope.source, &location.below(&["source"])),
        ),
    ]);

    if let Some(declared) = context.ir.scopes.get(scope.scope.as_str()) {
        write_consumer_extensions(&mut item, &declared.extensions);
    }

    item
}

/// One requirement of an operation, or `None` for a kind the emitter does not know.
fn requirement_item(
    context: &mut EmitContext<'_>,
    requirement: &Requirement,
    location: &IrLocation,
) -> Option<JsonObject> {
    let Ok(known) = KnownRequirementRef::try_from(requirement) else {
        refuse_unknown(context, &location.below(&["kind"]), requirement.tag());

        return None;
    };

    Some(match known {
        KnownRequirementRef::Right(right) => {
            let mut item =
                JsonObject::from_members([("right", JsonValue::text(right.right.as_str()))]);

            set_defined(&mut item, "params", copy_optional(right.params.as_ref()));
            set_defined(
                &mut item,
                "subject",
                right.subject.as_ref().map(|subject| {
                    source_value(
                        context,
                        &subject.source,
                        &location.below(&["subject", "source"]),
                    )
                }),
            );
            set_defined(&mut item, "entry", optional_text(right.entry.as_deref()));

            if let Some(declared) = context.ir.rights.get(right.right.as_str()) {
                write_consumer_extensions(&mut item, &declared.extensions);
            }

            item
        }
        KnownRequirementRef::Rule(rule) => {
            let mut item =
                JsonObject::from_members([("rule", JsonValue::text(rule.rule.as_str()))]);

            set_defined(&mut item, "params", copy_optional(rule.params.as_ref()));
            set_defined(
                &mut item,
                "bucket",
                optional_text(rule.bucket.as_ref().map(|bucket| bucket.as_str())),
            );
            set_defined(&mut item, "entry", optional_text(rule.entry.as_deref()));

            if let Some(declared) = context.ir.rules.get(rule.rule.as_str()) {
                write_consumer_extensions(&mut item, &declared.extensions);
            }

            item
        }
    })
}
