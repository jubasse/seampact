//! The `x-seampact-*` marks an operation carries: concurrency, idempotency, maturity and the rest.

use seampact_ir::{KnownIdempotencyRef, KnownUnknownQueryRef, Operation, Reason};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::ExtensionName;
use crate::emit_context::{
    EmitContext, optional_reason, reason_value, refuse_unknown, write_extension,
};
use crate::ir_text::value_source_text;
use crate::json_value::{integer_value, optional_text, set_defined, text_value};

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

/// Writes the marks of an operation: concurrency, idempotency, owner, limits, maturity and more.
pub(crate) fn write_operation_marks(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    document_format: Option<&str>,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    if let Some(concurrency) = &operation.concurrency {
        let version = value_source_text(
            context,
            &concurrency.version,
            &location.below(&["concurrency", "version"]),
        );
        let mark = JsonObject::from_iter([
            ("version".to_owned(), text_value(&version)),
            ("field".to_owned(), text_value(&concurrency.field)),
        ]);

        write_extension(
            context,
            target,
            ExtensionName::Concurrency,
            JsonValue::Object(mark),
        );
    }

    write_idempotency(context, operation, target, location);

    if let Some(owner) = &operation.owner {
        write_extension(
            context,
            target,
            ExtensionName::Owner,
            text_value(owner.kind.as_str()),
        );
    }

    write_unknown_query(context, operation, target, location);

    if let Some(budget) = operation.budget_ms {
        write_extension(
            context,
            target,
            ExtensionName::BudgetMs,
            integer_value(budget),
        );
    }

    if !operation.upstream.is_empty() {
        let services = operation
            .upstream
            .iter()
            .map(|service| text_value(service.as_str()))
            .collect();

        write_extension(
            context,
            target,
            ExtensionName::Upstream,
            JsonValue::Array(services),
        );
    }

    write_maturity(context, operation, target);
    write_degradable(context, operation, target);
    write_deprecation(context, operation, target);

    if operation.internal {
        write_extension(
            context,
            target,
            ExtensionName::Internal,
            JsonValue::Bool(true),
        );
    }

    if let Some(relays) = &operation.relays {
        let mark = JsonObject::from_iter([
            ("api".to_owned(), text_value(&relays.api)),
            ("operationId".to_owned(), text_value(relays.id.as_str())),
        ]);

        write_extension(
            context,
            target,
            ExtensionName::Relays,
            JsonValue::Object(mark),
        );
    }

    if Some(operation.format.as_str()) != document_format {
        write_extension(
            context,
            target,
            ExtensionName::Format,
            text_value(operation.format.as_str()),
        );
    }
}

/// Writes the maturity level, its source and, unless reasons are omitted, its reason.
fn write_maturity(context: &EmitContext<'_>, operation: &Operation, target: &mut JsonObject) {
    let maturity = &operation.maturity;
    let mut mark = JsonObject::from_iter([
        ("level".to_owned(), text_value(maturity.level.as_str())),
        ("source".to_owned(), text_value(maturity.source.as_str())),
    ]);

    set_defined(
        &mut mark,
        "reason",
        optional_text(optional_reason(
            context,
            maturity.reason.as_ref().map(Reason::as_str),
        )),
    );
    write_extension(
        context,
        target,
        ExtensionName::Maturity,
        JsonValue::Object(mark),
    );
}

/// Writes the paths and header an operation degrades under.
fn write_degradable(context: &EmitContext<'_>, operation: &Operation, target: &mut JsonObject) {
    let Some(degradable) = &operation.degradable else {
        return;
    };
    let paths = degradable
        .paths
        .iter()
        .map(|path| text_value(path))
        .collect();
    let mut mark = JsonObject::from_iter([("paths".to_owned(), JsonValue::Array(paths))]);

    set_defined(
        &mut mark,
        "header",
        optional_text(degradable.header.as_deref()),
    );
    write_extension(
        context,
        target,
        ExtensionName::Degradable,
        JsonValue::Object(mark),
    );
}

/// Writes the idempotency of an operation: its header contract, or the reason it is exempt.
fn write_idempotency(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    let Some(idempotency) = &operation.idempotency else {
        return;
    };
    let Ok(known) = KnownIdempotencyRef::try_from(idempotency) else {
        let kind_location = location.below(&["idempotency", "kind"]);

        return refuse_unknown(context, &kind_location, idempotency.tag());
    };
    let mark = match known {
        KnownIdempotencyRef::Exempt(exempt) => JsonObject::from_iter([(
            "exempt".to_owned(),
            reason_value(context, exempt.reason.as_str()),
        )]),
        KnownIdempotencyRef::Derived(derived) => JsonObject::from_iter([
            ("header".to_owned(), text_value(&derived.header)),
            (
                "replayHeader".to_owned(),
                text_value(&derived.replay_header),
            ),
            ("lifetimeMs".to_owned(), integer_value(derived.lifetime_ms)),
            ("required".to_owned(), JsonValue::Bool(derived.required)),
            ("enforce".to_owned(), text_value(derived.enforce.as_str())),
        ]),
    };

    write_extension(
        context,
        target,
        ExtensionName::Idempotency,
        JsonValue::Object(mark),
    );
}
