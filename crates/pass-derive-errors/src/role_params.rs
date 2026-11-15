//! The params of a role binding (ADR 0002 section 11, Errors and natures, docs/ir/07): an
//! authored `params` template read by the shared template reader with the role's data as its
//! slots, or the by-name template when none is written. The rendered params must validate against
//! the code's params schema whatever the data, which `role_param_types.rs` checks. Role data are
//! flat, so an `each` inside another `each`'s `as` is refused.

use std::collections::HashSet;

use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    ErrorCode, IrMap, KnownMemberNameRef, KnownTemplateRef, KnownTypeUseRef, MemberName,
    ObjectTemplate, ObjectTemplateMember, PlainMemberName, Property, Schema, SchemaId, SchemaRef,
    Slot, SlotTemplate, Template,
};
use seampact_json::JsonValue;
use seampact_pipeline::{
    DerivationRole, RoleDatum, TreeSchemaService, derivation_datum_always,
    derivation_param_of_datum, pointer_below,
};
use seampact_templates::{
    TemplateFault, TemplateSite, TemplateSlot, TemplateSlotKind, template_read,
};

use crate::report::{DeriveErrorsProblem, DeriveErrorsReporter, DeriveErrorsRule};
use crate::role_param_fit::{derive_errors_object_of_use, derive_errors_ref_use};

/// What reading a binding's params gives: refused (each fault reported), or the params template,
/// absent without params.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DeriveErrorsRoleParams {
    Refused,
    Written { params: Option<Template> },
}

/// A role binding's params as one reading needs them.
#[derive(Clone)]
pub(crate) struct DeriveErrorsRoleParamsSite<'site> {
    pub(crate) schemas: &'site IrMap<SchemaId, Schema>,
    /// The example validator of tree.schemas, which checks a literal against its param's use.
    pub(crate) examples: &'site dyn TreeSchemaService,
    pub(crate) role: &'static DerivationRole,
    pub(crate) code: &'site ErrorCode,
    /// The params schema of the code; absent when it declares none.
    pub(crate) params_schema: Option<&'site SchemaRef>,
    /// The written template; absent for the by-name template.
    pub(crate) template: Option<&'site JsonValue>,
    /// The param `conventions.rateLimit.param` names, which receives `rateLimited`'s delay.
    pub(crate) rate_limit_param: Option<&'site str>,
    /// Where problems are reported: the binding, or the declaration a default binding checks.
    pub(crate) pointer: String,
}

/// The slot an `each`'s `as` reads its item from.
pub(crate) const DERIVE_ERRORS_ITEM_SLOT: &str = "item";

/// The param a datum fills by name (see `derivation_param_of_datum`).
pub(crate) fn derive_errors_param_of_datum<'site>(
    site: &DeriveErrorsRoleParamsSite<'site>,
    datum: &'site RoleDatum,
) -> &'site str {
    derivation_param_of_datum(&site.role.role, datum, site.rate_limit_param)
}

/// Whether a datum has a value wherever its role answers (see `derivation_datum_always`).
pub(crate) fn derive_errors_datum_always(
    site: &DeriveErrorsRoleParamsSite<'_>,
    datum: &RoleDatum,
) -> bool {
    derivation_datum_always(&site.role.role, datum, site.rate_limit_param)
}

/// The properties of a code's params schema, in its order; empty without params.
///
/// # Errors
///
/// An internal error when the params name a schema the draft lacks.
pub(crate) fn derive_errors_param_properties<'schemas>(
    schemas: &'schemas IrMap<SchemaId, Schema>,
    params: Option<&SchemaRef>,
) -> Result<Vec<&'schemas Property>, InternalError> {
    let Some(params) = params else {
        return Ok(Vec::new());
    };
    let use_ = derive_errors_ref_use(params);

    // tree.schemas compiles params to an object schema or refuses them (`fields-schema`), and no
    // later half runs then.
    let object = derive_errors_object_of_use(schemas, &KnownTypeUseRef::try_from(&use_)?)?;

    Ok(object.map_or_else(Vec::new, |object| object.properties.iter().collect()))
}

// A datum's slot kind sets where the reader lets it stand: `$each` takes an array, `$merge` an
// object.
fn slot_kind_of(
    schemas: &IrMap<SchemaId, Schema>,
    use_: &KnownTypeUseRef<'_>,
) -> Result<TemplateSlotKind, InternalError> {
    if matches!(use_, KnownTypeUseRef::Array(_)) {
        return Ok(TemplateSlotKind::Array);
    }

    if derive_errors_object_of_use(schemas, use_)?.is_some() {
        return Ok(TemplateSlotKind::Object);
    }

    Ok(TemplateSlotKind::Value)
}

/// What a template of a role binding is read with: the role's data as slots and the names its
/// messages use; [`TemplateSite`] borrows it.
struct RoleTemplateSite {
    slots: Vec<TemplateSlot>,
    each_slots: Vec<TemplateSlot>,
    owner: String,
    place_name: String,
    example_slot: String,
}

fn site_of(site: &DeriveErrorsRoleParamsSite<'_>) -> Result<RoleTemplateSite, InternalError> {
    let role = site.role;
    let mut slots = Vec::new();
    let mut each_slots = Vec::new();

    for datum in &role.data {
        let use_ = KnownTypeUseRef::try_from(&datum.type_use)?;

        slots.push(TemplateSlot {
            name: datum.name.to_owned(),
            kind: slot_kind_of(site.schemas, &use_)?,
        });

        if let KnownTypeUseRef::Array(array) = &use_ {
            each_slots.push(TemplateSlot {
                name: DERIVE_ERRORS_ITEM_SLOT.to_owned(),
                kind: slot_kind_of(site.schemas, &KnownTypeUseRef::try_from(&*array.items)?)?,
            });
        }
    }

    let first_slot = role
        .data
        .first()
        .map_or(DERIVE_ERRORS_ITEM_SLOT, |datum| datum.name);

    Ok(RoleTemplateSite {
        slots,
        each_slots,
        owner: format!("the binding of role '{}'", role.role),
        place_name: format!("the params of role '{}'", role.role),
        example_slot: format!("${first_slot}"),
    })
}

/// The raw key of a member: a member name starting with `$` is written `$$`.
pub(crate) fn derive_errors_raw_key_of(name: &str) -> String {
    if name.starts_with('$') {
        format!("${name}")
    } else {
        name.to_owned()
    }
}

fn raw_key_of_member(name: &MemberName) -> Result<String, InternalError> {
    match KnownMemberNameRef::try_from(name)? {
        KnownMemberNameRef::Text(text) => Ok(derive_errors_raw_key_of(&text.text)),
        KnownMemberNameRef::Slot(slot) => Ok(format!("${}", slot.slot)),
    }
}

// The raw pointer of an `each` written inside another `each`'s `as`, if any.
fn nested_each_pointer(
    template: &Template,
    pointer: &str,
    in_each: bool,
) -> Result<Option<String>, InternalError> {
    match KnownTemplateRef::try_from(template)? {
        KnownTemplateRef::Each(each) => {
            if in_each {
                return Ok(Some(pointer.to_owned()));
            }

            nested_each_pointer(&each.r#as, &pointer_below(pointer, &["$as"]), true)
        }
        KnownTemplateRef::Array(array) => {
            for (index, item) in array.items.iter().enumerate() {
                let item_pointer = pointer_below(pointer, &[&index.to_string()]);

                if let Some(found) = nested_each_pointer(item, &item_pointer, in_each)? {
                    return Ok(Some(found));
                }
            }

            Ok(None)
        }
        KnownTemplateRef::Object(object) => {
            for member in &object.members {
                let member_pointer = pointer_below(pointer, &[&raw_key_of_member(&member.name)?]);

                if let Some(found) = nested_each_pointer(&member.value, &member_pointer, in_each)? {
                    return Ok(Some(found));
                }
            }

            Ok(None)
        }
        KnownTemplateRef::Slot(_) | KnownTemplateRef::Text(_) | KnownTemplateRef::Literal(_) => {
            Ok(None)
        }
    }
}

// The top-level keys of a written template must be params of the code: a `$` key (a merge, a map,
// a slot name or a literal dollar) names none, and a template that is no object fills none.
fn check_top_level_keys(
    site: &DeriveErrorsRoleParamsSite<'_>,
    names: &HashSet<&str>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, InternalError> {
    let params_pointer = pointer_below(&site.pointer, &["params"]);
    let role = &site.role.role;
    let code = quote_text(site.code.as_str());
    let template = match site.template {
        Some(JsonValue::Object(template)) if !template.contains_key("$each") => template,
        _ => {
            reporter.error(DeriveErrorsProblem {
                rule: DeriveErrorsRule::RoleParam,
                message: format!(
                    "the params template of role '{role}' is no object, so it fills no param of {code}"
                ),
                fix: "write params as an object whose keys are params of the code: { <param>: $<datum> }".to_owned(),
                pointer: params_pointer,
                related: Vec::new(),
            })?;

            return Ok(false);
        }
    };
    let mut accepted = true;

    for key in template.keys() {
        if names.contains(key.as_str()) {
            continue;
        }

        let quoted_key = quote_text(key);

        accepted = false;
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::RoleParam,
            message: format!(
                "the params template of role '{role}' writes {quoted_key}, which is no param of {code}"
            ),
            fix: format!(
                "write only params of {code} as keys, or add a param {quoted_key} to it"
            ),
            pointer: pointer_below(&params_pointer, &[key]),
            related: Vec::new(),
        })?;
    }

    Ok(accepted)
}

/// The by-name template: one member per param that has a datum of its name, in the params
/// schema's order.
fn by_name_template(site: &DeriveErrorsRoleParamsSite<'_>, properties: &[&Property]) -> Template {
    let mut members = Vec::new();

    for property in properties {
        let datum = site
            .role
            .data
            .iter()
            .find(|candidate| derive_errors_param_of_datum(site, candidate) == property.name);

        if let Some(datum) = datum {
            members.push(ObjectTemplateMember {
                name: MemberName::Text(PlainMemberName {
                    text: property.name.clone(),
                }),
                value: Template::Slot(SlotTemplate {
                    slot: Slot::new(datum.name.to_owned()),
                    path: Vec::new(),
                }),
            });
        }
    }

    Template::Object(ObjectTemplate {
        members,
        merge: None,
    })
}

/// Reads the params of a binding: the written template or the by-name one; each fault is reported
/// at its pointer.
///
/// # Errors
///
/// An internal error when the params schema or the role's data cannot be read.
pub(crate) fn derive_errors_read_role_params(
    site: &DeriveErrorsRoleParamsSite<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<DeriveErrorsRoleParams, InternalError> {
    let properties = derive_errors_param_properties(site.schemas, site.params_schema)?;
    let names: HashSet<&str> = properties
        .iter()
        .map(|property| property.name.as_str())
        .collect();

    if site.template.is_some() && !check_top_level_keys(site, &names, reporter)? {
        return Ok(DeriveErrorsRoleParams::Refused);
    }

    if site.params_schema.is_none() {
        return Ok(DeriveErrorsRoleParams::Written { params: None });
    }

    let template = match site.template {
        None => Some(by_name_template(site, &properties)),
        Some(raw) => read_written(site, raw, reporter)?,
    };

    Ok(template.map_or(DeriveErrorsRoleParams::Refused, |params| {
        DeriveErrorsRoleParams::Written {
            params: Some(params),
        }
    }))
}

fn read_written(
    site: &DeriveErrorsRoleParamsSite<'_>,
    raw: &JsonValue,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<Template>, InternalError> {
    let pointer = pointer_below(&site.pointer, &["params"]);
    let slots = site_of(site)?;
    let mut faults: Vec<TemplateFault> = Vec::new();
    let template = {
        let mut report = |fault: TemplateFault| faults.push(fault);
        let mut template_site = TemplateSite {
            slots: &slots.slots,
            each_slots: &slots.each_slots,
            owner: &slots.owner,
            place_name: &slots.place_name,
            example_slot: &slots.example_slot,
            adr_sections: "ADR 0006 section 6",
            report: &mut report,
        };

        template_read(&mut template_site, raw, &pointer)
    };
    let faulted = !faults.is_empty();

    for fault in faults {
        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::RoleTemplate,
            message: fault.message,
            fix: fault.fix,
            pointer: fault.pointer,
            related: Vec::new(),
        })?;
    }

    let Some(template) = template else {
        return Ok(None);
    };

    if faulted {
        return Ok(None);
    }

    let Some(nested) = nested_each_pointer(&template, &pointer, false)? else {
        return Ok(Some(template));
    };

    reporter.error(DeriveErrorsProblem {
        rule: DeriveErrorsRule::RoleTemplate,
        message: format!(
            "the params template of role '{}' maps with $each inside another $each, but role data are flat",
            site.role.role
        ),
        fix: "map the role's array datum once, writing each item's members inside $as".to_owned(),
        pointer: nested,
        related: Vec::new(),
    })?;

    Ok(None)
}

#[cfg(test)]
mod tests {
    use seampact_json::JsonObject;
    use seampact_pipeline::derivation_roles;
    use seampact_pipeline::testing::FakeSchemaService;

    use super::*;
    use crate::tests::with_reporter;

    const BINDING_POINTER: &str = "/conventions/errors/derived/unauthenticated";

    const RAW_WITH_TEMPLATE: &str = r#"{"conventions":{"errors":{"derived":{"unauthenticated":
        {"code":"auth.required","params":{"b":1,"10":2,"9":3,"𐐀":4}}}}}}"#;

    #[test]
    fn the_keys_of_a_written_template_are_reported_in_javascript_key_order() {
        let mut object = JsonObject::new();

        for key in ["b", "10", "9", "\u{10400}"] {
            object.insert(key.to_owned(), JsonValue::String("$code".to_owned()));
        }

        let template = JsonValue::Object(object);
        let service = FakeSchemaService::new();
        let schemas = IrMap::new();
        let code = ErrorCode::new("auth.required".to_owned());
        let role = derivation_roles()
            .iter()
            .find(|candidate| candidate.role.as_str() == "unauthenticated")
            .unwrap();
        let site = DeriveErrorsRoleParamsSite {
            schemas: &schemas,
            examples: &service,
            role,
            code: &code,
            params_schema: None,
            template: Some(&template),
            rate_limit_param: None,
            pointer: BINDING_POINTER.to_owned(),
        };

        let (accepted, reported) = with_reporter(RAW_WITH_TEMPLATE, |reporter| {
            check_top_level_keys(&site, &HashSet::new(), reporter)
        })
        .unwrap();
        let pointers: Vec<&str> = reported
            .iter()
            .map(|diagnostic| diagnostic.origin.pointer.as_str())
            .collect();

        assert_eq!(accepted, Ok(false));
        // Array-index keys first and ascending, then the others in written order.
        assert_eq!(
            pointers,
            [
                "/conventions/errors/derived/unauthenticated/params/9",
                "/conventions/errors/derived/unauthenticated/params/10",
                "/conventions/errors/derived/unauthenticated/params/b",
                "/conventions/errors/derived/unauthenticated/params/\u{10400}",
            ]
        );
    }

    #[test]
    fn a_template_that_is_no_object_fills_no_param() {
        let template = JsonValue::String("$code".to_owned());
        let service = FakeSchemaService::new();
        let schemas = IrMap::new();
        let code = ErrorCode::new("auth.required".to_owned());
        let role = derivation_roles().first().unwrap();
        let site = DeriveErrorsRoleParamsSite {
            schemas: &schemas,
            examples: &service,
            role,
            code: &code,
            params_schema: None,
            template: Some(&template),
            rate_limit_param: None,
            pointer: BINDING_POINTER.to_owned(),
        };

        let (accepted, reported) = with_reporter(RAW_WITH_TEMPLATE, |reporter| {
            check_top_level_keys(&site, &HashSet::new(), reporter)
        })
        .unwrap();

        assert_eq!(accepted, Ok(false));
        assert_eq!(reported.len(), 1);
    }
}
