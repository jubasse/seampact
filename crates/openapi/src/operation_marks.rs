//! The `x-seampact-*` marks an operation carries: deprecation and the unknown query policy.

use seampact_ir::{KnownUnknownQueryRef, Operation};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::ExtensionName;
use crate::emit_context::{EmitContext, reason_value, refuse_unknown, write_extension};
use crate::json_value::{optional_text, set_defined, text_value};

/// Writes the deprecation of an operation: the dates, the successor and its link relation.
fn write_deprecation(context: &EmitContext<'_>, operation: &Operation, target: &mut JsonObject) {
    let Some(deprecation) = &operation.deprecated else {
        return;
    };
    let mut value = JsonObject::from_iter([
        ("since".to_owned(), text_value(&deprecation.since)),
        ("sunset".to_owned(), text_value(&deprecation.sunset)),
    ]);

    if let Some(successor) = &deprecation.successor {
        let reference = JsonObject::from_iter([
            ("api".to_owned(), text_value(&successor.api)),
            ("operationId".to_owned(), text_value(successor.id.as_str())),
        ]);

        value.insert("successor".to_owned(), JsonValue::Object(reference));
    }

    set_defined(
        &mut value,
        "successorRel",
        optional_text(deprecation.successor_rel.as_deref()),
    );
    write_extension(
        context,
        target,
        ExtensionName::Deprecation,
        JsonValue::Object(value),
    );
}

/// Writes the mark of an ignored unknown query; a refused one is the default and has none.
fn write_unknown_query(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    let unknown_query = &operation.unknown_query;
    let Ok(known) = KnownUnknownQueryRef::try_from(unknown_query) else {
        let policy_location = location.below(&["unknownQuery", "policy"]);

        return refuse_unknown(context, &policy_location, unknown_query.tag());
    };

    if let KnownUnknownQueryRef::Ignore(ignore) = known {
        let value = JsonObject::from_iter([(
            "ignore".to_owned(),
            reason_value(context, ignore.reason.as_str()),
        )]);

        write_extension(
            context,
            target,
            ExtensionName::UnknownQuery,
            JsonValue::Object(value),
        );
    }
}
