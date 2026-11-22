//! The comparison of the schema, scalar and enum catalogues.

use std::borrow::Borrow;
use std::hash::Hash;

use seampact_diff_table::{DiffKind, IrDefinition};
use seampact_ir::{
    IrMap, KnownSchemaRef, KnownUnionTagRef, MapSchema, ObjectSchema, Property, UnionSchema,
};
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;

use crate::DiffError;
use crate::change_sink::{ChangeReach, ElementOrigin, RawChange};
use crate::not_ported::not_ported_yet;
use crate::walk_context::{
    ChangeSite, MemberComparisons, WalkContext, compare_kept_order, compare_members, emit_at,
    refuse_unknown_value, without_position,
};
use crate::walk_json::{flag_value, object_members, pointer_join, text_value};
use crate::walk_reach::{common_reaches, enum_reach_key, schema_reach_key};
use crate::walk_type_use::{compare_enum_values, compare_nullable, compare_type_use};

/// The comparison of a member that holds a deprecation flag.
type FlagComparison<'comparison> = &'comparison dyn Fn(
    &mut WalkContext<'_>,
    &str,
    Option<&JsonValue>,
    Option<&JsonValue>,
) -> Result<(), DiffError>;

/// The ids both catalogues hold, in UTF-16 code unit order.
pub(crate) fn common_ids<K, V>(before: &IrMap<K, V>, after: &IrMap<K, V>) -> Vec<String>
where
    K: AsRef<str> + Borrow<str> + Hash + Eq,
{
    let mut ids: Vec<String> = after
        .keys()
        .map(Borrow::borrow)
        .filter(|id: &&str| before.contains_key(*id))
        .map(str::to_owned)
        .collect();

    ids.sort_by(|left, right| cmp_utf16(left, right));

    ids
}

/// Compares the schemas both IRs hold; an unknown kind is refused.
pub(crate) fn compare_schema_catalogue(context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    let (before_ir, after_ir) = (context.before, context.after);

    for id in common_ids(&before_ir.schemas, &after_ir.schemas) {
        let (Some(before), Some(after)) = (
            before_ir.schemas.get(id.as_str()),
            after_ir.schemas.get(id.as_str()),
        ) else {
            continue;
        };
        let reaches = common_reaches(
            &context.before_reach,
            &context.after_reach,
            &schema_reach_key(&id),
        );
        let pointer = pointer_join("", &["schemas", &id]);
        let kind_pointer = pointer_join(&pointer, &["kind"]);
        let Ok(known_before) = KnownSchemaRef::try_from(before) else {
            let site = ChangeSite {
                reaches: &reaches,
                origin: None,
            };

            refuse_unknown_value(context, &site, &kind_pointer, before.tag())?;

            continue;
        };
        let Ok(known_after) = KnownSchemaRef::try_from(after) else {
            let site = ChangeSite {
                reaches: &reaches,
                origin: None,
            };

            refuse_unknown_value(context, &site, &kind_pointer, after.tag())?;

            continue;
        };
        let site = ChangeSite {
            reaches: &reaches,
            origin: Some(schema_origin(known_after)),
        };

        compare_schema(context, &site, &pointer, known_before, known_after)?;
    }

    Ok(())
}

fn schema_origin(schema: KnownSchemaRef<'_>) -> ElementOrigin {
    match schema {
        KnownSchemaRef::Object(object) => ElementOrigin::from(&object.origin),
        KnownSchemaRef::Map(map) => ElementOrigin::from(&map.origin),
        KnownSchemaRef::Union(union) => ElementOrigin::from(&union.origin),
    }
}

fn schema_kind(schema: KnownSchemaRef<'_>) -> &'static str {
    match schema {
        KnownSchemaRef::Object(_) => "object",
        KnownSchemaRef::Map(_) => "map",
        KnownSchemaRef::Union(_) => "union",
    }
}

/// Compares two schemas: another kind is a change of type, the same kind is compared by its members.
fn compare_schema(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: KnownSchemaRef<'_>,
    after: KnownSchemaRef<'_>,
) -> Result<(), DiffError> {
    // An absent flag means false: only a flip of the flag is a change.
    let deprecated = |context: &mut WalkContext<'_>,
                      member_pointer: &str,
                      before_value: Option<&JsonValue>,
                      after_value: Option<&JsonValue>| {
        emit_deprecation_flip(context, site, member_pointer, before_value, after_value);

        Ok(())
    };

    match (before, after) {
        (KnownSchemaRef::Object(before_object), KnownSchemaRef::Object(after_object)) => {
            compare_object_schema(
                context,
                site,
                pointer,
                before_object,
                after_object,
                &deprecated,
            )
        }
        (KnownSchemaRef::Map(before_map), KnownSchemaRef::Map(after_map)) => {
            compare_map_schema(context, site, pointer, before_map, after_map, &deprecated)
        }
        (KnownSchemaRef::Union(before_union), KnownSchemaRef::Union(after_union)) => {
            compare_union_schema(
                context,
                site,
                pointer,
                before_union,
                after_union,
                &deprecated,
            )
        }
        (
            KnownSchemaRef::Object(_) | KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_),
            KnownSchemaRef::Object(_) | KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_),
        ) => {
            emit_at(
                context,
                site,
                RawChange::new(DiffKind::TypeChanged, "kind", pointer.to_owned()).between(
                    Some(text_value(schema_kind(before))),
                    Some(text_value(schema_kind(after))),
                ),
            );

            Ok(())
        }
    }
}

/// A `deprecation` change when the flag flipped, at no position; an absent flag means false.
fn emit_deprecation_flip(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) {
    let was_deprecated = matches!(before, Some(JsonValue::Bool(true)));
    let is_deprecated = matches!(after, Some(JsonValue::Bool(true)));

    if was_deprecated == is_deprecated {
        return;
    }

    let reaches: Vec<ChangeReach> = without_position(site.reaches);
    let site_without_position = ChangeSite {
        reaches: &reaches,
        origin: site.origin.clone(),
    };

    emit_at(
        context,
        &site_without_position,
        RawChange::new(
            DiffKind::Deprecation,
            if is_deprecated { "added" } else { "removed" },
            pointer.to_owned(),
        )
        .between(before.cloned(), after.cloned()),
    );
}

fn compare_object_schema(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &ObjectSchema,
    after: &ObjectSchema,
    deprecated: FlagComparison<'_>,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "deprecated",
        Box::new(|context, member_pointer, before_value, after_value| {
            deprecated(context, member_pointer, before_value, after_value)
        }),
    );
    comparisons.insert(
        "properties",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_properties(
                context,
                site,
                member_pointer,
                &before.properties,
                &after.properties,
            )
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::ObjectSchema,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

fn name_of(property: &Property) -> &str {
    &property.name
}

fn compare_properties(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &[Property],
    after: &[Property],
) -> Result<(), DiffError> {
    for (index, property) in after.iter().enumerate() {
        if before
            .iter()
            .any(|candidate| candidate.name == property.name)
        {
            continue;
        }

        let property_site = ChangeSite {
            origin: Some(ElementOrigin::from(&property.origin)),
            ..site.clone()
        };

        emit_at(
            context,
            &property_site,
            RawChange::new(
                DiffKind::PropertyAdded,
                optional_case(property),
                pointer_join(pointer, &[&index.to_string()]),
            )
            .between(None, Some(text_value(&property.name))),
        );
    }

    for (index, property) in before.iter().enumerate() {
        let Some((kept, after_property)) = after
            .iter()
            .position(|candidate| candidate.name == property.name)
            .and_then(|kept| after.get(kept).map(|found| (kept, found)))
        else {
            let property_site = ChangeSite {
                origin: Some(ElementOrigin::from(&property.origin)),
                ..site.clone()
            };

            emit_at(
                context,
                &property_site,
                RawChange::new(
                    DiffKind::PropertyRemoved,
                    optional_case(property),
                    pointer_join(pointer, &[&index.to_string()]),
                )
                .between(Some(text_value(&property.name)), None),
            );

            continue;
        };
        let property_site = ChangeSite {
            origin: Some(ElementOrigin::from(&after_property.origin)),
            ..site.clone()
        };

        compare_property(
            context,
            &property_site,
            &pointer_join(pointer, &[&kept.to_string()]),
            property,
            after_property,
        )?;
    }

    let before_names: Vec<&str> = before.iter().map(name_of).collect();
    let after_names: Vec<&str> = after.iter().map(name_of).collect();

    compare_kept_order(
        context,
        site,
        pointer,
        "properties",
        &before_names,
        &after_names,
    );

    Ok(())
}

fn optional_case(property: &Property) -> &'static str {
    if property.optional {
        "optional"
    } else {
        "required"
    }
}

fn compare_property(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Property,
    after: &Property,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "type",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_type_use(context, site, member_pointer, &before.r#type, &after.r#type)
        }),
    );
    comparisons.insert(
        "optional",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let case_name = if after.optional {
                "requiredToOptional"
            } else {
                "optionalToRequired"
            };

            emit_at(
                context,
                site,
                RawChange::new(
                    DiffKind::PropertyRequired,
                    case_name,
                    member_pointer.to_owned(),
                )
                .between(
                    Some(flag_value(before.optional)),
                    Some(flag_value(after.optional)),
                ),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "nullable",
        Box::new(|context, member_pointer, before_value, after_value| {
            compare_nullable(context, site, member_pointer, before_value, after_value);

            Ok(())
        }),
    );
    comparisons.insert(
        "default",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_default_change(context, site, member_pointer, before_value, after_value);

            Ok(())
        }),
    );
    comparisons.insert(
        "restrictedTo",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_restriction(context, site, member_pointer, before, after)
        }),
    );
    comparisons.insert(
        "deprecated",
        Box::new(|context, member_pointer, before_value, after_value| {
            emit_deprecation_flip(context, site, member_pointer, before_value, after_value);

            Ok(())
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::Property,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// Compares the `restrictedTo` marks of a property: a mark gained or lost, or changed in place.
fn compare_restriction(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &Property,
    after: &Property,
) -> Result<(), DiffError> {
    let (Some(before_mark), Some(after_mark)) = (&before.restricted_to, &after.restricted_to)
    else {
        emit_at(
            context,
            site,
            RawChange::new(
                DiffKind::FieldRight,
                if before.restricted_to.is_none() {
                    "added"
                } else {
                    "removed"
                },
                pointer.to_owned(),
            )
            .between(
                before
                    .restricted_to
                    .as_ref()
                    .map(|mark| text_value(mark.right.as_str())),
                after
                    .restricted_to
                    .as_ref()
                    .map(|mark| text_value(mark.right.as_str())),
            ),
        );

        return Ok(());
    };

    compare_members(
        context,
        site,
        IrDefinition::FieldRestriction,
        pointer,
        Some(&object_members(before_mark)?),
        Some(&object_members(after_mark)?),
        &MemberComparisons::new(),
    )
}

/// A `default.changed` change: added, removed or changed.
pub(crate) fn emit_default_change(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: Option<&JsonValue>,
    after: Option<&JsonValue>,
) {
    let default_case = if before.is_none() {
        "added"
    } else if after.is_none() {
        "removed"
    } else {
        "changed"
    };

    emit_at(
        context,
        site,
        RawChange::new(DiffKind::DefaultChanged, default_case, pointer.to_owned())
            .between(before.cloned(), after.cloned()),
    );
}

/// Compares the tag and the variants of two unions.
fn compare_union_schema(
    context: &mut WalkContext<'_>,
    site: &ChangeSite<'_>,
    pointer: &str,
    before: &UnionSchema,
    after: &UnionSchema,
    deprecated: FlagComparison<'_>,
) -> Result<(), DiffError> {
    let mut comparisons = MemberComparisons::new();

    comparisons.insert(
        "deprecated",
        Box::new(|context, member_pointer, before_value, after_value| {
            deprecated(context, member_pointer, before_value, after_value)
        }),
    );
    comparisons.insert(
        "tag",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            let place = pointer_join(member_pointer, &["in"]);

            if KnownUnionTagRef::try_from(&before.tag).is_err() {
                return refuse_unknown_value(context, site, &place, before.tag.tag());
            }

            if KnownUnionTagRef::try_from(&after.tag).is_err() {
                return refuse_unknown_value(context, site, &place, after.tag.tag());
            }

            emit_at(
                context,
                site,
                RawChange::new(DiffKind::UnionTag, "changed", member_pointer.to_owned()),
            );

            Ok(())
        }),
    );
    comparisons.insert(
        "variants",
        Box::new(|context, member_pointer, _before_value, _after_value| {
            compare_variants(context, site, member_pointer, before, after)
        }),
    );

    compare_members(
        context,
        site,
        IrDefinition::UnionSchema,
        pointer,
        Some(&object_members(before)?),
        Some(&object_members(after)?),
        &comparisons,
    )
}

/// Compares the variants of two unions.
///
/// # Errors
///
/// Not ported yet.
fn compare_variants(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &UnionSchema,
    _after: &UnionSchema,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareVariants"))
}

/// Compares the members of two map schemas.
///
/// # Errors
///
/// Not ported yet.
fn compare_map_schema(
    _context: &mut WalkContext<'_>,
    _site: &ChangeSite<'_>,
    _pointer: &str,
    _before: &MapSchema,
    _after: &MapSchema,
    _deprecated: FlagComparison<'_>,
) -> Result<(), DiffError> {
    Err(not_ported_yet("compareMapSchema"))
}

/// Compares the scalars of the two IRs.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn compare_scalar_catalogue(_context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    Err(not_ported_yet("compareScalarCatalogue"))
}

/// Compares the values of the enums both IRs hold.
pub(crate) fn compare_enum_catalogue(context: &mut WalkContext<'_>) -> Result<(), DiffError> {
    let (before_ir, after_ir) = (context.before, context.after);

    for id in common_ids(&before_ir.enums, &after_ir.enums) {
        let (Some(before), Some(after)) = (
            before_ir.enums.get(id.as_str()),
            after_ir.enums.get(id.as_str()),
        ) else {
            continue;
        };
        let reaches = common_reaches(
            &context.before_reach,
            &context.after_reach,
            &enum_reach_key(&id),
        );
        let site = ChangeSite {
            reaches: &reaches,
            origin: Some(ElementOrigin::from(&after.origin)),
        };
        let pointer = pointer_join("", &["enums", &id]);
        let mut comparisons = MemberComparisons::new();

        comparisons.insert(
            "values",
            Box::new(|context, member_pointer, _before_value, _after_value| {
                compare_enum_values(
                    context,
                    &site,
                    member_pointer,
                    &before.values,
                    &after.values,
                );

                Ok(())
            }),
        );

        compare_members(
            context,
            &site,
            IrDefinition::Enum,
            &pointer,
            Some(&object_members(before)?),
            Some(&object_members(after)?),
            &comparisons,
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_ids_are_the_shared_keys_in_utf16_code_unit_order() {
        let mut before: IrMap<String, u8> = IrMap::new();
        let mut after: IrMap<String, u8> = IrMap::new();

        for id in ["b", "\u{FF5E}", "\u{10000}", "only-before"] {
            before.insert(id.to_owned(), 1);
        }

        for id in ["\u{FF5E}", "\u{10000}", "b", "only-after"] {
            after.insert(id.to_owned(), 1);
        }

        assert_eq!(
            common_ids(&before, &after),
            vec![
                "b".to_owned(),
                "\u{10000}".to_owned(),
                "\u{FF5E}".to_owned()
            ]
        );
    }
}
