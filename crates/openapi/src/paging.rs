//! The paging of an operation: the default limit its parameters carry.

use seampact_ir::{
    NamedTemplate, Operation, PagingParamPlacement, PagingRole, PagingToken, RightId, TypeUse,
    ValueSource, ValueSourceIn, WireFormat,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::{IrLocation, NotGeneratedForm};

use crate::body_slots::{add_meta_slot, success_slots, url_schema};
use crate::emit_context::{
    EmitContext, refuse_inconsistent, refuse_not_emitted, refuse_unknown, write_extension,
};
use crate::ir_text::value_source_text;
use crate::json_value::{copy_optional, optional_integer, optional_text, set_defined};
use crate::parameters::ParameterPlace;
use crate::templates::{SlotSchemas, SlotValue, template_schema};
use crate::{ExtensionName, OpenApiError};

/// The slot of the records of a page.
const ITEMS_SLOT: &str = "items";

/// The slot of one record, inside `$each` over the records.
const ITEM_SLOT: &str = "item";

/// The slot of the member URL of one record, inside `$each`.
const ITEM_SELF_SLOT: &str = "itemSelf";

/// The default limit of the operation when the parameter `name` in `place` is its limit role.
pub(crate) fn paging_limit_default(
    context: &EmitContext<'_>,
    operation: &Operation,
    place: ParameterPlace,
    name: &str,
) -> Option<JsonValue> {
    let paging = operation.paging.as_ref()?;
    let style = context.ir.pagings.get(paging.style.as_ref()?.as_str())?;
    let limit_role = style
        .request
        .iter()
        .find(|role| role.role == PagingRole::Limit)?;

    if limit_role.r#in.as_str() != place.as_str() || limit_role.name != name {
        return None;
    }

    optional_integer(paging.default_limit)
}

/// The `x-seampact-paging` extension of an operation: its style, roles, limits and sort keys.
pub(crate) fn write_paging(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    target: &mut JsonObject,
    location: &IrLocation,
) {
    let Some(paging) = &operation.paging else {
        return;
    };
    let paging_location = location.below(&["paging"]);
    let Some(style_id) = &paging.style else {
        let none = JsonObject::from_members([("none", JsonValue::Bool(true))]);

        write_extension(
            context,
            target,
            ExtensionName::Paging,
            JsonValue::Object(none),
        );

        return;
    };
    let ir = context.ir;
    let Some(style) = ir.pagings.get(style_id.as_str()) else {
        refuse_inconsistent(
            context,
            "paging.style",
            &format!("The paging style '{style_id}' is not declared"),
            &paging_location.below(&["style"]),
        );

        return;
    };
    let mut value = JsonObject::from_members([
        ("style", JsonValue::text(style_id.as_str())),
        ("position", JsonValue::text(style.position.as_str())),
    ]);
    let mut roles = JsonObject::new();
    let style_location = IrLocation::root().below(&["pagings", style_id.as_str()]);

    for (index, role) in style.request.iter().enumerate() {
        let role_location = style_location.below(&["request", &index.to_string()]);
        let Some(source_place) = value_source_place(&role.r#in) else {
            refuse_unknown(context, &role_location.below(&["in"]), role.r#in.as_str());

            continue;
        };
        let source = ValueSource {
            r#in: source_place,
            name: Some(role.name.clone()),
            prefix_bits: None,
        };
        let text = value_source_text(context, &source, &role_location);

        roles.insert(role.role.as_str().to_owned(), JsonValue::text(&text));
    }

    value.insert("roles".to_owned(), JsonValue::Object(roles));
    set_defined(&mut value, "maxLimit", optional_integer(paging.max_limit));
    set_defined(
        &mut value,
        "defaultLimit",
        optional_integer(paging.default_limit),
    );
    value.insert(
        "overLimit".to_owned(),
        JsonValue::text(paging.over_limit.as_str()),
    );
    set_defined(
        &mut value,
        "token",
        optional_text(paging.token.as_ref().map(PagingToken::as_str)),
    );

    let sort_keys: Vec<JsonValue> = paging
        .sort_keys
        .iter()
        .enumerate()
        .map(|(index, sort_key)| {
            let mut item = JsonObject::from_members([("key", JsonValue::text(&sort_key.key))]);
            let subject_location =
                paging_location.below(&["sortKeys", &index.to_string(), "subject", "source"]);

            set_defined(
                &mut item,
                "right",
                optional_text(sort_key.right.as_ref().map(RightId::as_str)),
            );
            set_defined(&mut item, "params", copy_optional(sort_key.params.as_ref()));
            set_defined(
                &mut item,
                "subject",
                sort_key.subject.as_ref().map(|subject| {
                    JsonValue::text(&value_source_text(
                        context,
                        &subject.source,
                        &subject_location,
                    ))
                }),
            );

            JsonValue::Object(item)
        })
        .collect();

    value.insert("sortKeys".to_owned(), JsonValue::Array(sort_keys));
    write_extension(
        context,
        target,
        ExtensionName::Paging,
        JsonValue::Object(value),
    );
}

/// The place a paging request role reads, as a value source place; `None` for an unknown one.
fn value_source_place(placement: &PagingParamPlacement) -> Option<ValueSourceIn> {
    match placement {
        PagingParamPlacement::Query => Some(ValueSourceIn::Query),
        PagingParamPlacement::Header => Some(ValueSourceIn::Header),
        PagingParamPlacement::Unknown(_) => None,
    }
}

/// The slots a paging style's response body reads, by role.
fn paging_role_slots(context: &EmitContext<'_>, token: Option<&PagingToken>) -> SlotSchemas {
    let integer = || {
        SlotValue::always(JsonObject::from_members([(
            "type",
            JsonValue::text("integer"),
        )]))
    };
    let boolean = || {
        SlotValue::always(JsonObject::from_members([(
            "type",
            JsonValue::text("boolean"),
        )]))
    };
    let string = || JsonObject::from_members([("type", JsonValue::text("string"))]);
    let since = if token == Some(&PagingToken::Instant) {
        JsonObject::from_members([
            ("type", JsonValue::text("string")),
            ("format", JsonValue::text("date-time")),
        ])
    } else {
        string()
    };

    SlotSchemas::from_iter([
        ("nextCursor".to_owned(), SlotValue::maybe(string())),
        ("previousCursor".to_owned(), SlotValue::maybe(string())),
        ("more".to_owned(), boolean()),
        ("page".to_owned(), integer()),
        ("offset".to_owned(), integer()),
        ("limit".to_owned(), integer()),
        ("from".to_owned(), integer()),
        ("to".to_owned(), integer()),
        ("total".to_owned(), integer()),
        ("totalPages".to_owned(), integer()),
        ("first".to_owned(), SlotValue::always(url_schema(context))),
        ("previous".to_owned(), SlotValue::maybe(url_schema(context))),
        ("next".to_owned(), SlotValue::maybe(url_schema(context))),
        ("last".to_owned(), SlotValue::always(url_schema(context))),
        ("nextSince".to_owned(), SlotValue::always(since)),
        ("complete".to_owned(), boolean()),
    ])
}

/// The schema of a page body: the style's own body, or the format's page shape, over the item schema.
///
/// # Errors
///
/// As the writers of the meta slot and of the body template.
pub(crate) fn page_body_schema(
    context: &mut EmitContext<'_>,
    operation: &Operation,
    format: &WireFormat,
    item_use: &TypeUse,
    item_schema: JsonObject,
    status: i64,
    location: &IrLocation,
) -> Result<Option<JsonObject>, OpenApiError> {
    let ir = context.ir;
    let style = operation
        .paging
        .as_ref()
        .and_then(|paging| paging.style.as_ref())
        .and_then(|style_id| ir.pagings.get(style_id.as_str()));
    let Some(style) = style else {
        refuse_inconsistent(
            context,
            "page.style",
            "A page response without a paging style",
            location,
        );

        return Ok(None);
    };
    let root = IrLocation::root();

    if !style.response.headers.is_empty() {
        refuse_not_emitted(
            context,
            NotGeneratedForm::OpenapiPagingHeaders,
            "A paging style header",
            &root.below(&["pagings", style.id.as_str(), "response", "headers"]),
        );
    }

    let role_slots = paging_role_slots(
        context,
        operation
            .paging
            .as_ref()
            .and_then(|paging| paging.token.as_ref()),
    );
    let mut slots = success_slots(context, operation, status, item_use);

    for (slot, value) in &role_slots {
        slots.insert(slot.clone(), value.clone());
    }

    // Inside `$each` over the records: the record and its member URL (`$itemId` and `$itemFields` wait for a consumer).
    let mut element = slots.clone();

    element.insert(ITEM_SLOT.to_owned(), SlotValue::always(item_schema.clone()));
    element.insert(
        ITEM_SELF_SLOT.to_owned(),
        SlotValue::always(url_schema(context)),
    );

    let items_schema = JsonObject::from_members([
        ("type", JsonValue::text("array")),
        ("items", JsonValue::Object(item_schema)),
    ]);

    slots.insert(
        ITEMS_SLOT.to_owned(),
        SlotValue {
            element: Some(element),
            ..SlotValue::always(items_schema)
        },
    );

    let style_location = root.below(&["pagings", style.id.as_str(), "response"]);
    let body = style.response.body.as_ref();
    let style_meta: &[NamedTemplate] = if body.is_none() {
        &style.response.meta
    } else {
        &[]
    };

    add_meta_slot(
        context,
        &mut slots,
        format,
        style_meta,
        &style.absent,
        &role_slots,
        &style_location,
    )?;

    let (template, template_location, absent) = match body {
        Some(body) => (body, style_location.below(&["body"]), &style.absent),
        None => (
            &format.success.page.body,
            root.below(&["formats", format.id.as_str(), "success", "page", "body"]),
            &format.absent,
        ),
    };

    Ok(
        template_schema(context, template, &slots, absent, &template_location)?
            .map(|value| value.schema),
    )
}
