//! A field restriction's right, checked once per right and params.

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{FieldRestriction, Origin, Right};
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::params::{
    AccessRightsParamsKind, AccessRightsParamsUse, access_rights_check_params,
};
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
use crate::schema_use::AccessRightsContext;

/// A restriction whose right exists and whose params fit.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsCheckedRestriction {
    pub(crate) right: Right,
    pub(crate) params: Option<JsonValue>,
}

/// The restrictions checked so far, by key; `None` is a restriction refused with its error.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsRestrictionChecks {
    pub(crate) checked: HashMap<String, Option<AccessRightsCheckedRestriction>>,
    pub(crate) recursive: HashSet<String>,
    pub(crate) reaching: HashSet<String>,
}

/// Fresh checks, given the schemas from which a restricted field can be reached.
pub(crate) fn access_rights_restriction_checks(
    reaching: HashSet<String>,
) -> AccessRightsRestrictionChecks {
    AccessRightsRestrictionChecks {
        checked: HashMap::new(),
        recursive: HashSet::new(),
        reaching,
    }
}

/// The origin `tree.schemas` gave a `restrictedTo`, where its errors are located.
///
/// # Errors
///
/// An internal error for a restriction without origin.
pub(crate) fn access_rights_restriction_origin(
    restriction: &FieldRestriction,
) -> Result<&Origin, InternalError> {
    restriction.origin.as_ref().ok_or_else(|| {
        InternalError::new(format!(
            "tree.schemas wrote a restrictedTo of right '{}' without origin",
            restriction.right
        ))
    })
}

/// A restriction's right is declared and its params fit, checked once per restriction.
pub(crate) fn access_rights_check_restriction(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    checks: &mut AccessRightsRestrictionChecks,
    restriction: &FieldRestriction,
) -> Result<Option<AccessRightsCheckedRestriction>, PassError> {
    let pointer = access_rights_restriction_origin(restriction)?
        .pointer
        .clone();

    if let Some(checked) = checks.checked.get(&pointer) {
        return Ok(checked.clone());
    }

    let result = checked_restriction(context, reporter, catalogues, restriction, &pointer)?;

    checks.checked.insert(pointer, result.clone());

    Ok(result)
}

pub(crate) fn checked_restriction(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    restriction: &FieldRestriction,
    pointer: &str,
) -> Result<Option<AccessRightsCheckedRestriction>, PassError> {
    let Some(right) = catalogues.rights.get(restriction.right.as_str()) else {
        if !catalogues
            .declared
            .rights
            .contains(restriction.right.as_str())
        {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::FieldRightTarget,
                message: format!(
                    "the field is restricted to right '{}', which the rights catalogue does not declare",
                    access_rights_quoted(restriction.right.as_str())
                ),
                fix: "declare the right in 'rights', or name a declared one".to_owned(),
                pointer: pointer.to_owned(),
                distinct_by: None,
                related: Vec::new(),
            });
        }

        return Ok(None);
    };

    let checked = access_rights_check_params(
        context,
        reporter,
        &AccessRightsParamsUse {
            rule: AccessRightsRule::FieldRightParams,
            kind: AccessRightsParamsKind::Right,
            name: right.id.as_str().to_owned(),
            holder: "the field's restrictedTo".to_owned(),
            schema: right
                .params
                .as_ref()
                .map(|schema| schema.as_str().to_owned()),
            params: restriction.params.clone(),
            params_pointer: pointer_below(pointer, &["params"]),
            use_pointer: pointer.to_owned(),
        },
    )?;

    Ok(checked.map(|checked| AccessRightsCheckedRestriction {
        right: right.clone(),
        params: checked.params,
    }))
}
