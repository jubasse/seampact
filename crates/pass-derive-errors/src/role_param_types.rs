//! The typed check of a role binding's params: every param the template fills gets a value its
//! type use takes, whatever the role's data hold, and a required param gets one whenever the
//! binding answers.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTemplate, EachTemplate, KnownTemplateRef, KnownTextPartRef, KnownTypeUseRef, ObjectSchema,
    ObjectTemplate, ScalarType, ScalarTypeUse, SlotTemplate, Template, TextTemplate,
};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::report::DeriveErrorsReporter;
use crate::role_param_fit::{
    DeriveErrorsFit, DeriveErrorsMisfitReason, DeriveErrorsTyped, derive_errors_misfit,
    derive_errors_no_refinements, derive_errors_object_of_use, derive_errors_ref_use,
    derive_errors_scalar_use,
};
use crate::role_params::DeriveErrorsRoleParamsSite;

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
    _check: &TypedCheck<'check>,
    _position: &Position<'check>,
    _slot: &str,
    _path: &[String],
) -> Result<SlotValue<'check>, PassError> {
    Err(not_ported_yet("slotValue"))
}

fn refuse(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _message: String,
    _fix: String,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuse"))
}

fn refuse_type(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _what: &str,
    _reason: &DeriveErrorsMisfitReason,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseType"))
}

fn refuse_member(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _member: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseMember"))
}

fn refuse_unknown_path(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _value: &MissingSlotMember,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseUnknownPath"))
}

fn refuse_missing(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _member: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseMissing"))
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

fn check_literal(
    _check: &mut TypedCheck<'_>,
    _value: &JsonValue,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkLiteral"))
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
            return refuse_unknown_path(check, position, &missing, reporter);
        }
        SlotValue::Found { typed, .. } => typed,
    };
    let Some(reason) = derive_errors_misfit(&check.fit, &typed, accepted)? else {
        return Ok(());
    };
    let mut written = vec![template.slot.as_str()];

    written.extend(template.path.iter().map(String::as_str));

    refuse_type(
        check,
        position,
        &format!("${}", written.join(".")),
        &reason,
        reporter,
    )
}

fn check_text(
    _check: &mut TypedCheck<'_>,
    _template: &TextTemplate,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkText"))
}

fn check_object_value(
    _check: &mut TypedCheck<'_>,
    _template: &ObjectTemplate,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkObjectValue"))
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
    _check: &mut TypedCheck<'_>,
    _template: ListTemplate<'_>,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkArrayValue"))
}

fn check_items(
    _check: &mut TypedCheck<'_>,
    _template: ListTemplate<'_>,
    _items: &KnownTypeUseRef<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkItems"))
}

fn check_object(
    _check: &mut TypedCheck<'_>,
    _template: &KnownTemplateRef<'_>,
    _schema: &ObjectSchema,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkObject"))
}

// `$merge` of an object slot writes each member of its schema beside the written ones: each is
// checked as if written (located at the merge), and the required ones of a slot the role always
// supplies are filled.
fn check_merged(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _template: &ObjectTemplate,
    _schema: &ObjectSchema,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("checkMerged"))
}
