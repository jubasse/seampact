//! The params of a role binding (ADR 0002 section 11, Errors and natures, docs/ir/07): an
//! authored `params` template read by the shared template reader with the role's data as its
//! slots, or the by-name template when none is written. The rendered params must validate against
//! the code's params schema whatever the data, which `role_param_types.rs` checks. Role data are
//! flat, so an `each` inside another `each`'s `as` is refused.

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ErrorCode, IrMap, KnownTypeUseRef, MemberName, ObjectTemplate, ObjectTemplateMember,
    PlainMemberName, Property, RefTypeUse, Schema, SchemaId, SchemaRef, Slot, SlotTemplate,
    Template, TypeUse,
};
use seampact_json::JsonValue;
use seampact_pipeline::{
    DerivationRole, PassError, RoleDatum, TreeSchemaService, derivation_datum_always,
    derivation_param_of_datum,
};
use seampact_templates::{TemplateSite, TemplateSlotKind};

use crate::not_ported::not_ported_yet;
use crate::report::DeriveErrorsReporter;
use crate::role_param_fit::derive_errors_object_of_use;

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
    let use_ = TypeUse::Ref(RefTypeUse {
        schema: params.clone(),
        unknown_keys: None,
        nullable: None,
        docs: None,
        examples: None,
    });

    // tree.schemas compiles params to an object schema or refuses them (`fields-schema`), and no
    // later half runs then.
    let object = derive_errors_object_of_use(schemas, &KnownTypeUseRef::try_from(&use_)?)?;

    Ok(object.map_or_else(Vec::new, |object| object.properties.iter().collect()))
}

// A datum's slot kind sets where the reader lets it stand: `$each` takes an array, `$merge` an
// object.
fn slot_kind_of(
    _schemas: &IrMap<SchemaId, Schema>,
    _use: &KnownTypeUseRef<'_>,
) -> Result<TemplateSlotKind, PassError> {
    Err(not_ported_yet("slotKindOf"))
}

fn site_of<'site>(
    _site: &'site DeriveErrorsRoleParamsSite<'site>,
    _faults: &'site mut usize,
    _reporter: &'site mut DeriveErrorsReporter<'_, '_>,
) -> Result<TemplateSite<'site>, PassError> {
    Err(not_ported_yet("siteOf"))
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
    match seampact_ir::KnownMemberNameRef::try_from(name)? {
        seampact_ir::KnownMemberNameRef::Text(text) => Ok(derive_errors_raw_key_of(&text.text)),
        seampact_ir::KnownMemberNameRef::Slot(slot) => Ok(format!("${}", slot.slot)),
    }
}

// The raw pointer of an `each` written inside another `each`'s `as`, if any.
fn nested_each_pointer(
    _template: &Template,
    _pointer: &str,
    _in_each: bool,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("nestedEachPointer"))
}

// The top-level keys of a written template must be params of the code: a `$` key (a merge, a map,
// a slot name or a literal dollar) names none, and a template that is no object fills none.
fn check_top_level_keys(
    _site: &DeriveErrorsRoleParamsSite<'_>,
    _names: &HashSet<&str>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("checkTopLevelKeys"))
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
/// A [`PassError`] when the written template cannot be read yet.
pub(crate) fn derive_errors_read_role_params(
    site: &DeriveErrorsRoleParamsSite<'_>,
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<DeriveErrorsRoleParams, PassError> {
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
    _site: &DeriveErrorsRoleParamsSite<'_>,
    _raw: &JsonValue,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Option<Template>, PassError> {
    Err(not_ported_yet("readWritten"))
}
