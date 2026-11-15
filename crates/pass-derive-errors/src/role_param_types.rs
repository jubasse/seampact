//! The typed check of a role binding's params: every param the template fills gets a value its
//! type use takes, whatever the role's data hold, and a required param gets one whenever the
//! binding answers.

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    ArrayTemplate, EachTemplate, KnownMemberNameRef, KnownTemplateRef, KnownTextPartRef,
    KnownTypeUseRef, ObjectSchema, ObjectTemplate, ScalarType, ScalarTypeUse, SlotTemplate,
    Template, TextTemplate,
};
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{PassError, pointer_below};

use crate::report::{DeriveErrorsProblem, DeriveErrorsReporter, DeriveErrorsRule};
use crate::role_param_fit::{
    DeriveErrorsFit, DeriveErrorsJsonKind, DeriveErrorsKinds, DeriveErrorsMisfitKind,
    DeriveErrorsMisfitReason, DeriveErrorsTyped, derive_errors_copied_use,
    derive_errors_describe_kinds, derive_errors_kinds_fit, derive_errors_kinds_of,
    derive_errors_member_misfits, derive_errors_misfit, derive_errors_misfit_reason,
    derive_errors_no_refinements, derive_errors_object_of_use, derive_errors_ref_use,
    derive_errors_scalar_use,
};
use crate::role_params::{
    DERIVE_ERRORS_ITEM_SLOT, DeriveErrorsRoleParamsSite, derive_errors_datum_always,
    derive_errors_raw_key_of,
};

/// The checks of one binding: its site, the fit and the number of faults found so far.
pub(crate) struct TypedCheck<'check> {
    pub(crate) site: &'check DeriveErrorsRoleParamsSite<'check>,
    pub(crate) fit: DeriveErrorsFit<'check>,
    pub(crate) faults: usize,
}

/// Where a template stands: the top-level param it fills and its raw pointer.
#[derive(Debug, Clone)]
pub(crate) struct Position<'position> {
    pub(crate) param: String,
    pub(crate) pointer: String,
    /// The type use of the item `item` reads inside an `each`.
    pub(crate) item: Option<KnownTypeUseRef<'position>>,
}

/// The member a slot's path names that does not exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MissingSlotMember {
    pub(crate) datum: String,
    pub(crate) member: String,
}

/// The value a slot renders and whether it always has one; or the member its path names that does
/// not exist.
#[derive(Debug, Clone)]
pub(crate) enum SlotValue<'value> {
    Found {
        typed: DeriveErrorsTyped<'value>,
        always: bool,
    },
    Missing(MissingSlotMember),
}

/// A template that writes a list: written items or an `each`.
#[derive(Debug, Clone, Copy)]
pub(crate) enum ListTemplate<'template> {
    Array(&'template ArrayTemplate),
    Each(&'template EachTemplate),
}

/// The number of items a list template writes: the bounds it provably stays within.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ItemCounts {
    pub(crate) min: Option<i64>,
    pub(crate) max: Option<i64>,
}

/// The use a text template renders.
fn string_use() -> ScalarTypeUse {
    derive_errors_scalar_use(ScalarType::String, None, derive_errors_no_refinements())
}

/// Checks that the params a template renders validate against the code's params schema; `false`
/// when refused.
///
/// # Errors
///
/// A [`PassError`] when the template cannot be checked yet.
pub(crate) fn derive_errors_check_role_param_types(
    site: &DeriveErrorsRoleParamsSite<'_>,
    template: &Template,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    let Some(params_schema) = site.params_schema else {
        return Ok(true);
    };
    let params_use = derive_errors_ref_use(params_schema);
    let Some(schema) =
        derive_errors_object_of_use(site.schemas, &KnownTypeUseRef::try_from(&params_use)?)?
    else {
        return Err(InternalError::new(format!(
            "the params schema {} of '{}' is no object schema",
            params_schema, site.code
        ))
        .into());
    };
    let mut check = TypedCheck {
        site,
        fit: DeriveErrorsFit {
            schemas: site.schemas,
            examples: site.examples,
        },
        faults: 0,
    };
    // A by-name template is not written, so its problems are located at the binding.
    let pointer = if site.template.is_none() {
        site.pointer.clone()
    } else {
        pointer_below(&site.pointer, &["params"])
    };
    let position = Position {
        param: String::new(),
        pointer,
        item: None,
    };

    check_object(
        &mut check,
        &KnownTemplateRef::try_from(template)?,
        schema,
        &position,
        reporter,
    )?;

    Ok(check.faults == 0)
}

fn slot_value<'check>(
    check: &TypedCheck<'check>,
    position: &Position<'check>,
    slot: &str,
    path: &[String],
) -> Result<SlotValue<'check>, PassError> {
    let site = check.site;
    let datum = site
        .role
        .data
        .iter()
        .find(|candidate| candidate.name == slot);
    let named = match datum {
        Some(datum) => Some(KnownTypeUseRef::try_from(&datum.type_use)?),
        None if slot == DERIVE_ERRORS_ITEM_SLOT => position.item,
        None => None,
    };

    // The reader lets a template read only the role's data, and `item` only inside the `as` of an
    // array datum.
    let Some(mut use_) = named else {
        return Err(InternalError::new(format!(
            "the slot ${slot} at {} reads no datum",
            position.pointer
        ))
        .into());
    };
    let mut always = datum.is_none_or(|datum| derive_errors_datum_always(site, datum));
    let mut nullable = false;
    let mut read = slot.to_owned();

    for member in path {
        let property = derive_errors_object_of_use(site.schemas, &use_)?.and_then(|object| {
            object
                .properties
                .iter()
                .find(|candidate| candidate.name == *member)
        });
        let Some(property) = property else {
            return Ok(SlotValue::Missing(MissingSlotMember {
                datum: read,
                member: member.clone(),
            }));
        };

        use_ = KnownTypeUseRef::try_from(&property.r#type)?;
        always = always && !property.optional;
        nullable = property.nullable;
        read = format!("{read}.{member}");
    }

    Ok(SlotValue::Found {
        typed: DeriveErrorsTyped { use_, nullable },
        always,
    })
}

fn refuse(
    check: &mut TypedCheck<'_>,
    position: &Position<'_>,
    message: String,
    fix: String,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    check.faults += 1;

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::RoleParamType,
        message,
        fix,
        pointer: position.pointer.clone(),
        related: Vec::new(),
    })
}

fn refuse_type(
    check: &mut TypedCheck<'_>,
    position: &Position<'_>,
    what: &str,
    reason: &DeriveErrorsMisfitReason,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let role = &check.site.role.role;
    let code = quote_text(check.site.code.as_str());
    let param = quote_text(&position.param);
    let message = format!(
        "role '{role}' fills the param {param} of {code} with {what}, but {}",
        reason.text
    );

    if reason.kind == DeriveErrorsMisfitKind::Omittable {
        let fix = format!(
            "fill {param} with a datum role '{role}' always supplies, or make it optional in {code}"
        );

        check.faults += 1;

        return reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::RoleParamRequired,
            message,
            fix,
            pointer: position.pointer.clone(),
            related: Vec::new(),
        });
    }

    let fix = format!(
        "fill {param} with a value its type provably takes, or change the param's type in {code}"
    );

    refuse(check, position, message, fix, reporter)
}

fn refuse_member(
    check: &mut TypedCheck<'_>,
    position: &Position<'_>,
    member: &str,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let role = &check.site.role.role;
    let code = quote_text(check.site.code.as_str());
    let message = format!(
        "role '{role}' writes the member {} into the param {} of {code}, whose type has no such member",
        quote_text(member),
        quote_text(&position.param)
    );
    let fix = format!(
        "write only members of the param's type, or add {} to it",
        quote_text(member)
    );

    refuse(check, position, message, fix, reporter)
}

fn refuse_unknown_path(
    check: &mut TypedCheck<'_>,
    position: &Position<'_>,
    value: &MissingSlotMember,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let role = &check.site.role.role;
    let message = format!(
        "role '{role}' reads ${}.{}, but ${} has no member {}",
        value.datum,
        value.member,
        value.datum,
        quote_text(&value.member)
    );
    let fix = format!("read a member ${} has, or the datum itself", value.datum);

    refuse(check, position, message, fix, reporter)
}

fn refuse_missing(
    check: &mut TypedCheck<'_>,
    position: &Position<'_>,
    member: &str,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), InternalError> {
    let role = &check.site.role.role;
    let code = quote_text(check.site.code.as_str());
    let param = quote_text(&position.param);
    let location = if member == position.param {
        String::new()
    } else {
        format!(" (its member {})", quote_text(member))
    };

    check.faults += 1;

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::RoleParamRequired,
        message: format!(
            "role '{role}' may leave the required param {param} of {code}{location} without a value"
        ),
        fix: format!(
            "fill it with a literal or a datum role '{role}' always supplies, or make it optional in {code}"
        ),
        pointer: position.pointer.clone(),
        related: Vec::new(),
    })
}

/// Whether a template always renders a value (docs/ir/07: a slot without a value has none, and so
/// on up).
fn always_valued(
    check: &TypedCheck<'_>,
    position: &Position<'_>,
    template: &KnownTemplateRef<'_>,
) -> Result<bool, PassError> {
    match template {
        KnownTemplateRef::Literal(_) | KnownTemplateRef::Array(_) => Ok(true),
        KnownTemplateRef::Slot(slot) => {
            slot_always(check, position, slot.slot.as_str(), &slot.path)
        }
        KnownTemplateRef::Text(text) => {
            for part in &text.parts {
                let always = match KnownTextPartRef::try_from(part)? {
                    KnownTextPartRef::Text(_) => true,
                    KnownTextPartRef::Slot(slot) => {
                        slot_always(check, position, slot.slot.as_str(), &slot.path)?
                    }
                };

                if !always {
                    return Ok(false);
                }
            }

            Ok(true)
        }
        KnownTemplateRef::Each(each) => slot_always(check, position, each.of.as_str(), &[]),
        KnownTemplateRef::Object(object) => {
            for member in &object.members {
                if always_valued(check, position, &KnownTemplateRef::try_from(&member.value)?)? {
                    return Ok(true);
                }
            }

            Ok(false)
        }
    }
}

fn slot_always(
    check: &TypedCheck<'_>,
    position: &Position<'_>,
    slot: &str,
    path: &[String],
) -> Result<bool, PassError> {
    Ok(match slot_value(check, position, slot, path)? {
        SlotValue::Found { always, .. } => always,
        SlotValue::Missing(_) => false,
    })
}

fn check_value(
    check: &mut TypedCheck<'_>,
    template: &KnownTemplateRef<'_>,
    accepted: &DeriveErrorsTyped<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    match template {
        KnownTemplateRef::Literal(literal) => {
            check_literal(check, &literal.value, accepted, position, reporter)
        }
        KnownTemplateRef::Slot(slot) => check_slot(check, slot, accepted, position, reporter),
        KnownTemplateRef::Text(text) => check_text(check, text, accepted, position, reporter),
        KnownTemplateRef::Object(object) => {
            check_object_value(check, object, accepted, position, reporter)
        }
        KnownTemplateRef::Array(array) => check_array_value(
            check,
            ListTemplate::Array(array),
            accepted,
            position,
            reporter,
        ),
        KnownTemplateRef::Each(each) => check_array_value(
            check,
            ListTemplate::Each(each),
            accepted,
            position,
            reporter,
        ),
    }
}

// A literal goes through the example validator of tree.schemas, each issue located inside the
// literal.
fn check_literal(
    check: &mut TypedCheck<'_>,
    value: &JsonValue,
    accepted: &DeriveErrorsTyped<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    if matches!(value, JsonValue::Null) && accepted.nullable {
        return Ok(());
    }

    let issues = check
        .fit
        .examples
        .check_example(value, &derive_errors_copied_use(&accepted.use_))?;

    for issue in issues {
        let located = Position {
            pointer: format!("{}{}", position.pointer, issue.pointer),
            ..position.clone()
        };

        refuse_type(
            check,
            &located,
            &format!("the literal {}", stringify_json(value)),
            &derive_errors_misfit_reason(format!("it does not fit its type: {}", issue.message)),
            reporter,
        )?;
    }

    Ok(())
}

fn check_slot(
    check: &mut TypedCheck<'_>,
    template: &SlotTemplate,
    accepted: &DeriveErrorsTyped<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let typed = match slot_value(check, position, template.slot.as_str(), &template.path)? {
        SlotValue::Missing(missing) => {
            return Ok(refuse_unknown_path(check, position, &missing, reporter)?);
        }
        SlotValue::Found { typed, .. } => typed,
    };
    let Some(reason) = derive_errors_misfit(&check.fit, &typed, accepted)? else {
        return Ok(());
    };
    let mut written = vec![template.slot.as_str()];

    written.extend(template.path.iter().map(String::as_str));

    Ok(refuse_type(
        check,
        position,
        &format!("${}", written.join(".")),
        &reason,
        reporter,
    )?)
}

// A text renders a string; a number or boolean part is its JSON text, an object or array part has
// no text form.
fn check_text(
    check: &mut TypedCheck<'_>,
    template: &TextTemplate,
    accepted: &DeriveErrorsTyped<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let string = string_use();
    let rendered = DeriveErrorsTyped {
        use_: KnownTypeUseRef::Scalar(&string),
        nullable: false,
    };

    if let Some(reason) = derive_errors_misfit(&check.fit, &rendered, accepted)? {
        refuse_type(check, position, "a text", &reason, reporter)?;

        return Ok(());
    }

    for part in &template.parts {
        let KnownTextPartRef::Slot(slot) = KnownTextPartRef::try_from(part)? else {
            continue;
        };

        let value = slot_value(check, position, slot.slot.as_str(), &slot.path)?;
        let SlotValue::Found { typed, .. } = value else {
            let SlotValue::Missing(missing) = value else {
                continue;
            };

            refuse_unknown_path(check, position, &missing, reporter)?;

            continue;
        };
        let kinds = derive_errors_kinds_of(&DeriveErrorsTyped {
            nullable: false,
            ..typed
        })?;

        if has_no_text_form(&kinds) {
            refuse_type(
                check,
                position,
                &format!("a text holding ${}", slot.slot),
                &derive_errors_misfit_reason("it has no text form".to_owned()),
                reporter,
            )?;
        }
    }

    Ok(())
}

fn has_no_text_form(kinds: &DeriveErrorsKinds) -> bool {
    match kinds {
        DeriveErrorsKinds::Any => true,
        DeriveErrorsKinds::Only(kinds) => {
            kinds.contains(&DeriveErrorsJsonKind::Object)
                || kinds.contains(&DeriveErrorsJsonKind::Array)
        }
    }
}

fn check_object_value(
    check: &mut TypedCheck<'_>,
    template: &ObjectTemplate,
    accepted: &DeriveErrorsTyped<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    if matches!(accepted.use_, KnownTypeUseRef::Opaque(_)) {
        return Ok(());
    }

    let schemas = check.site.schemas;
    let Some(schema) = derive_errors_object_of_use(schemas, &accepted.use_)? else {
        let kinds = derive_errors_describe_kinds(&derive_errors_kinds_of(accepted)?);

        refuse_type(
            check,
            position,
            "an object",
            &derive_errors_misfit_reason(format!(
                "the param's type ({kinds}) is no object schema to check its members against"
            )),
            reporter,
        )?;

        return Ok(());
    };

    check_object(
        check,
        &KnownTemplateRef::Object(template),
        schema,
        position,
        reporter,
    )
}

// The number of items an array template writes, or an `each` maps from its array datum.
fn item_counts(
    check: &TypedCheck<'_>,
    template: ListTemplate<'_>,
    position: &Position<'_>,
) -> Result<ItemCounts, PassError> {
    let each = match template {
        ListTemplate::Array(array) => {
            let written = i64::try_from(array.items.len()).map_err(|_| {
                InternalError::new("an array template writes more items than an integer counts")
            })?;

            return Ok(ItemCounts {
                min: Some(written),
                max: Some(written),
            });
        }
        ListTemplate::Each(each) => each,
    };
    let mapped = slot_value(check, position, each.of.as_str(), &[])?;

    Ok(match mapped {
        SlotValue::Found {
            typed:
                DeriveErrorsTyped {
                    use_: KnownTypeUseRef::Array(array),
                    ..
                },
            ..
        } => ItemCounts {
            min: array.min_items,
            max: array.max_items,
        },
        SlotValue::Found { .. } | SlotValue::Missing(_) => ItemCounts {
            min: None,
            max: None,
        },
    })
}

fn check_array_value(
    check: &mut TypedCheck<'_>,
    template: ListTemplate<'_>,
    accepted: &DeriveErrorsTyped<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let kinds = derive_errors_kinds_of(accepted)?;
    let what = match template {
        ListTemplate::Array(_) => "an array".to_owned(),
        ListTemplate::Each(each) => format!("$each over ${}", each.of),
    };
    let array_kinds = DeriveErrorsKinds::Only(HashSet::from([DeriveErrorsJsonKind::Array]));

    if !derive_errors_kinds_fit(&array_kinds, &kinds) {
        refuse_type(
            check,
            position,
            &what,
            &derive_errors_misfit_reason(format!(
                "the param's type ({}) does not take an array",
                derive_errors_describe_kinds(&kinds)
            )),
            reporter,
        )?;

        return Ok(());
    }

    let KnownTypeUseRef::Array(array) = accepted.use_ else {
        return Ok(());
    };
    let counts = item_counts(check, template, position)?;

    if let Some(minimum) = array.min_items
        && counts.min.is_none_or(|own| own < minimum)
    {
        refuse_type(
            check,
            position,
            &what,
            &derive_errors_misfit_reason(format!(
                "it may hold fewer items than the param's minItems {minimum}"
            )),
            reporter,
        )?;
    }

    if let Some(maximum) = array.max_items
        && counts.max.is_none_or(|own| own > maximum)
    {
        refuse_type(
            check,
            position,
            &what,
            &derive_errors_misfit_reason(format!(
                "it may hold more items than the param's maxItems {maximum}"
            )),
            reporter,
        )?;
    }

    check_items(
        check,
        template,
        &KnownTypeUseRef::try_from(&*array.items)?,
        position,
        reporter,
    )
}

fn check_items(
    check: &mut TypedCheck<'_>,
    template: ListTemplate<'_>,
    items: &KnownTypeUseRef<'_>,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let accepted = DeriveErrorsTyped {
        use_: *items,
        nullable: false,
    };

    let each = match template {
        ListTemplate::Array(array) => {
            for (index, item) in array.items.iter().enumerate() {
                let item_position = Position {
                    pointer: pointer_below(&position.pointer, &[&index.to_string()]),
                    ..position.clone()
                };

                check_value(
                    check,
                    &KnownTemplateRef::try_from(item)?,
                    &accepted,
                    &item_position,
                    reporter,
                )?;
            }

            return Ok(());
        }
        ListTemplate::Each(each) => each,
    };
    let mapped = slot_value(check, position, each.of.as_str(), &[])?;
    let item = match mapped {
        SlotValue::Found {
            typed:
                DeriveErrorsTyped {
                    use_: KnownTypeUseRef::Array(array),
                    ..
                },
            ..
        } => Some(KnownTypeUseRef::try_from(&*array.items)?),
        SlotValue::Found { .. } | SlotValue::Missing(_) => None,
    };
    let as_position = Position {
        param: position.param.clone(),
        pointer: pointer_below(&position.pointer, &["$as"]),
        item,
    };

    check_value(
        check,
        &KnownTemplateRef::try_from(&*each.r#as)?,
        &accepted,
        &as_position,
        reporter,
    )
}

fn check_object(
    check: &mut TypedCheck<'_>,
    template: &KnownTemplateRef<'_>,
    schema: &ObjectSchema,
    position: &Position<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    let KnownTemplateRef::Object(template) = template else {
        return Ok(());
    };
    let top = position.param.is_empty();
    let mut filled: HashSet<String> = HashSet::new();
    let mut written: HashMap<String, Position<'_>> = HashMap::new();

    for member in &template.members {
        // Only `$collection` names a member by slot, and no role supplies it.
        let KnownMemberNameRef::Text(named) = KnownMemberNameRef::try_from(&member.name)? else {
            return Err(InternalError::new(format!(
                "the role params at {} name a member by slot",
                position.pointer
            ))
            .into());
        };
        let name = &named.text;
        let member_position = Position {
            param: if top {
                name.clone()
            } else {
                position.param.clone()
            },
            pointer: if check.site.template.is_none() {
                position.pointer.clone()
            } else {
                pointer_below(&position.pointer, &[&derive_errors_raw_key_of(name)])
            },
            item: position.item,
        };
        let Some(property) = schema
            .properties
            .iter()
            .find(|candidate| candidate.name == *name)
        else {
            refuse_member(check, &member_position, name, reporter)?;

            continue;
        };
        let value = KnownTemplateRef::try_from(&member.value)?;
        let faults_before = check.faults;

        written.insert(name.clone(), member_position.clone());

        check_value(
            check,
            &value,
            &DeriveErrorsTyped {
                use_: KnownTypeUseRef::try_from(&property.r#type)?,
                nullable: property.nullable,
            },
            &member_position,
            reporter,
        )?;

        // A member refused for its value is not reported again as maybe missing.
        if check.faults > faults_before || always_valued(check, &member_position, &value)? {
            filled.insert(name.clone());
        }
    }

    filled.extend(check_merged(check, position, template, schema, reporter)?);

    // A member written without a sure value is located where it is written, a missing one at its
    // object.
    for property in &schema.properties {
        if property.optional || filled.contains(&property.name) {
            continue;
        }

        let located = match written.get(&property.name) {
            Some(at) => at.clone(),
            None if top => Position {
                param: property.name.clone(),
                ..position.clone()
            },
            None => position.clone(),
        };

        refuse_missing(check, &located, &property.name, reporter)?;
    }

    Ok(())
}

// `$merge` of an object slot writes each member of its schema beside the written ones: each is
// checked as if written (located at the merge), and the required ones of a slot the role always
// supplies are filled.
fn check_merged(
    check: &mut TypedCheck<'_>,
    position: &Position<'_>,
    template: &ObjectTemplate,
    schema: &ObjectSchema,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Vec<String>, PassError> {
    let Some(merge) = &template.merge else {
        return Ok(Vec::new());
    };
    let value = slot_value(check, position, merge.as_str(), &[])?;
    let schemas = check.site.schemas;
    let merged = match &value {
        SlotValue::Found { typed, .. } => derive_errors_object_of_use(schemas, &typed.use_)?,
        SlotValue::Missing(_) => None,
    };

    // The reader lets `$merge` take an object slot only.
    let (SlotValue::Found { always, .. }, Some(merged)) = (&value, merged) else {
        return Err(InternalError::new(format!(
            "the $merge at {} reads no object datum",
            position.pointer
        ))
        .into());
    };
    let merge_position = Position {
        pointer: if check.site.template.is_none() {
            position.pointer.clone()
        } else {
            pointer_below(&position.pointer, &["$merge"])
        },
        ..position.clone()
    };
    let mut written_names: HashSet<String> = HashSet::new();

    for member in &template.members {
        if let KnownMemberNameRef::Text(named) = KnownMemberNameRef::try_from(&member.name)? {
            written_names.insert(named.text.clone());
        }
    }

    let misfits = derive_errors_member_misfits(
        &check.fit,
        merged,
        schema,
        &written_names,
        &mut HashSet::new(),
    )?;

    for misfit in &misfits {
        let located = Position {
            param: if position.param.is_empty() {
                misfit.member.clone()
            } else {
                position.param.clone()
            },
            ..merge_position.clone()
        };

        if misfit.lacking {
            refuse_member(check, &located, &misfit.member, reporter)?;
        } else {
            refuse_type(
                check,
                &located,
                &format!("${merge}.{}", misfit.member),
                &misfit.reason,
                reporter,
            )?;
        }
    }

    // A member refused here is not filled_names again as maybe missing.
    let mut filled_names: Vec<String> = misfits.into_iter().map(|entry| entry.member).collect();

    if *always {
        filled_names.extend(
            merged
                .properties
                .iter()
                .filter(|property| !property.optional)
                .map(|property| property.name.clone()),
        );
    }

    Ok(filled_names)
}

#[cfg(test)]
mod tests {
    use seampact_ir::{ErrorCode, IrMap, Schema, SchemaId};
    use seampact_pipeline::testing::FakeSchemaService;
    use seampact_pipeline::{TreeSchemaExampleIssue, derivation_roles};

    use super::*;
    use crate::tests::with_reporter;

    const RAW: &str = r#"{"a":{"b":1}}"#;

    fn literal_diagnostics(
        value: &str,
        accepted_nullable: bool,
        issues: Vec<TreeSchemaExampleIssue>,
    ) -> (String, Vec<seampact_diagnostics::Diagnostic>) {
        let schemas: IrMap<SchemaId, Schema> = IrMap::new();
        let examples = FakeSchemaService::new().with_example_issues(issues);
        let code = ErrorCode::new("shop.code".to_owned());
        let role = derivation_roles().first().unwrap();
        let site = DeriveErrorsRoleParamsSite {
            schemas: &schemas,
            examples: &examples,
            role,
            code: &code,
            params_schema: None,
            template: None,
            rate_limit_param: None,
            pointer: "/a".to_owned(),
        };
        let mut check = TypedCheck {
            site: &site,
            fit: DeriveErrorsFit {
                schemas: &schemas,
                examples: &examples,
            },
            faults: 0,
        };
        let string = string_use();
        let accepted = DeriveErrorsTyped {
            use_: KnownTypeUseRef::Scalar(&string),
            nullable: accepted_nullable,
        };
        let position = Position {
            param: "p".to_owned(),
            pointer: "/a".to_owned(),
            item: None,
        };
        let literal: JsonValue =
            JsonValue::try_from(serde_json::from_str::<serde_json::Value>(value).unwrap()).unwrap();
        let (result, reported) = with_reporter(RAW, |reporter| {
            check_literal(&mut check, &literal, &accepted, &position, reporter)
        })
        .unwrap();

        result.unwrap();

        (role.role.to_string(), reported)
    }

    #[test]
    fn a_literal_is_quoted_as_javascript_writes_it_and_located_inside_itself() {
        let issue = TreeSchemaExampleIssue {
            pointer: "/b".to_owned(),
            message: "bad".to_owned(),
        };
        let (role, reported) = literal_diagnostics(
            r#"{"b":1,"2":2,"big":1e21,"neg":-0,"huge":9007199254740993}"#,
            false,
            vec![issue],
        );
        let [diagnostic] = reported.as_slice() else {
            panic!("one diagnostic expected, got {reported:?}");
        };

        assert_eq!(
            diagnostic.message,
            format!(
                "role '{role}' fills the param 'p' of 'shop.code' with the literal {{\"2\":2,\"b\":1,\"big\":1e+21,\"neg\":0,\"huge\":9007199254740992}}, but it does not fit its type: bad"
            )
        );
        assert_eq!(diagnostic.origin.pointer, "/a/b");
    }

    #[test]
    fn a_null_literal_fits_a_nullable_param_whatever_the_validator_says() {
        let issue = TreeSchemaExampleIssue {
            pointer: String::new(),
            message: "bad".to_owned(),
        };
        let (_, reported) = literal_diagnostics("null", true, vec![issue.clone()]);

        assert!(reported.is_empty(), "{reported:?}");

        let (_, refused) = literal_diagnostics("null", false, vec![issue]);

        assert_eq!(refused.len(), 1, "{refused:?}");
    }
}
