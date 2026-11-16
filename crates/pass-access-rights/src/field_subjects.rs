//! The subject of a field right: the id of the resource it checks, or its scope.

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    FieldRightSubject, KnownRightSubjectRef, OpShorthand, OperationScope, Property,
    ResourceSubject, Right, ValueSource, ValueSourceIn,
};
use seampact_pipeline::PassError;

use crate::catalogues::AccessRightsCatalogues;
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::AccessRightsRestrictedField;
use crate::restrictions::access_rights_restriction_origin;
use crate::routes::{AccessRightsRoute, access_rights_operation_of};
use crate::schema_use::AccessRightsContext;
use crate::subjects::{
    AccessRightsSourceSchema, AccessRightsSubjectResult, DefaultSubject,
    access_rights_default_member_id, access_rights_property_schema, access_rights_same_schema,
};

/// A route with the scopes it enters.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsFieldRoute {
    pub(crate) route: AccessRightsRoute,
    pub(crate) scopes: Vec<OperationScope>,
}

/// One restricted field's scope use, with the pointer it is written at.
#[derive(Debug, Clone)]
pub(crate) struct FieldScopeUse<'draft, 'route> {
    pub(crate) field_route: &'route AccessRightsFieldRoute,
    pub(crate) field: &'route AccessRightsRestrictedField<'draft>,
    pub(crate) right: &'route Right,
    pub(crate) pointer: String,
}

/// The field as a message names it: the body's schema and the pointer.
pub(crate) fn access_rights_field_text(field: &AccessRightsRestrictedField<'_>) -> String {
    access_rights_quoted(&format!("{}{}", field.schema, field.pointer))
}

pub(crate) fn restricted_here(
    field: &AccessRightsRestrictedField<'_>,
) -> Result<Vec<AccessRightsRelated>, InternalError> {
    Ok(vec![AccessRightsRelated {
        pointer: access_rights_restriction_origin(field.restriction)?
            .pointer
            .clone(),
        message: format!(
            "the field is restricted to '{}' here",
            access_rights_quoted(field.restriction.right.as_str())
        ),
    }])
}

/// The schema a resource right's subject must have: its id schema, with the schema it names.
pub(crate) fn access_rights_id_schema_of(
    catalogues: &AccessRightsCatalogues,
    right: &Right,
    subject: &ResourceSubject,
) -> AccessRightsSourceSchema {
    AccessRightsSourceSchema {
        type_use: subject.id_schema.clone(),
        name: catalogues.right_id_names.get(right.id.as_str()).cloned(),
        optional: false,
    }
}

// On input the subject must be found (ADR 0003 section 6). A `create` route has no member id of
// the resource it creates, so a resource right cannot restrict its input.
pub(crate) fn access_rights_input_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    field_route: &AccessRightsFieldRoute,
    field: &AccessRightsRestrictedField<'_>,
    right: &Right,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, PassError> {
    let route = &field_route.route;
    let operation = access_rights_operation_of(context, route)?;
    let pointer = match &operation.input {
        Some(input) => input.origin.pointer.clone(),
        None => context.nodes.get(route.node)?.pointer.clone(),
    };
    let distinct_by = format!("{}{}", field.schema, field.pointer);
    let field_text = access_rights_field_text(field);
    let resource = match KnownRightSubjectRef::try_from(&right.subject)? {
        KnownRightSubjectRef::NoSubject(_) => {
            return Ok(AccessRightsSubjectResult::Resolved { subject: None });
        }
        KnownRightSubjectRef::Scope(subject) => {
            let scope_use = FieldScopeUse {
                field_route,
                field,
                right,
                pointer,
            };

            return Ok(scope_subject(
                reporter,
                catalogues,
                &scope_use,
                subject.scope.as_str(),
            )?);
        }
        KnownRightSubjectRef::Resource(subject) => subject,
    };

    if operation.op == Some(OpShorthand::Create) {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::FieldRightSubject,
            message: format!(
                "input field '{field_text}' of create route '{}' is restricted to resource right '{}', and a create route has no id of the resource it creates",
                route.id,
                access_rights_quoted(right.id.as_str())
            ),
            fix: "restrict the field in the create input to a scope right or a right without subject"
                .to_owned(),
            pointer,
            distinct_by: Some(distinct_by),
            related: restricted_here(field)?,
        });

        return Ok(AccessRightsSubjectResult::Refused);
    }

    let defaulted = access_rights_default_member_id(
        context,
        route.node,
        &access_rights_id_schema_of(catalogues, right, resource),
    )?;
    let candidates = match defaulted {
        DefaultSubject::Found { source } => {
            return Ok(AccessRightsSubjectResult::Resolved {
                subject: Some(FieldRightSubject { source }),
            });
        }
        DefaultSubject::Ambiguous { candidates } => candidates,
        DefaultSubject::None => Vec::new(),
    };
    let right_text = access_rights_quoted(right.id.as_str());
    let message = if candidates.is_empty() {
        format!(
            "input field '{field_text}' of route '{}' is restricted to right '{right_text}', and no member id of the route has its id schema",
            route.id
        )
    } else {
        let names: Vec<String> = candidates
            .iter()
            .map(|candidate| format!("'{}'", access_rights_quoted(&candidate.name)))
            .collect();

        format!(
            "input field '{field_text}' of route '{}' is restricted to right '{right_text}', and its subject could be member id {}",
            route.id,
            names.join(" or ")
        )
    };
    let mut related = restricted_here(field)?;

    related.extend(candidates.iter().map(|candidate| AccessRightsRelated {
        pointer: candidate.pointer.clone(),
        message: format!(
            "member id '{}' has the right's id schema",
            access_rights_quoted(&candidate.name)
        ),
    }));

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::FieldRightSubject,
        message,
        fix: "restrict the field to a right whose subject the route resolves, or use another input schema on this route".to_owned(),
        pointer,
        distinct_by: Some(distinct_by),
        related,
    });

    Ok(AccessRightsSubjectResult::Refused)
}

pub(crate) fn scope_subject(
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    scope_use: &FieldScopeUse<'_, '_>,
    scope: &str,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, InternalError> {
    let FieldScopeUse {
        field_route,
        field,
        right,
        pointer,
    } = scope_use;

    // The right's scope is refused: its declaration has the error, so a use adds none.
    if !catalogues.scopes.contains_key(scope) {
        return Ok(AccessRightsSubjectResult::Refused);
    }

    if field_route
        .scopes
        .iter()
        .any(|resolved| resolved.scope.as_str() == scope)
    {
        return Ok(AccessRightsSubjectResult::Resolved {
            subject: Some(FieldRightSubject {
                source: ValueSource {
                    r#in: ValueSourceIn::Scope,
                    name: Some(scope.to_owned()),
                    prefix_bits: None,
                },
            }),
        });
    }

    let quoted_scope = access_rights_quoted(scope);

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::FieldRightSubject,
        message: format!(
            "field '{}' of route '{}' is restricted to right '{}' of scope '{quoted_scope}', which the route does not resolve",
            access_rights_field_text(field),
            field_route.route.id,
            access_rights_quoted(right.id.as_str())
        ),
        fix: format!(
            "enter scope '{quoted_scope}' on the route or an ancestor, or restrict the field to another right"
        ),
        pointer: pointer.clone(),
        distinct_by: Some(format!("{}{}", field.schema, field.pointer)),
        related: restricted_here(field)?,
    });

    Ok(AccessRightsSubjectResult::Refused)
}

// On output a resource right reads the holder's property whose schema is the right's id schema.
// The property must be required: an optional one would leave the field with a right and no subject
// value.
pub(crate) fn access_rights_output_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    field_route: &AccessRightsFieldRoute,
    field: &AccessRightsRestrictedField<'_>,
    right: &Right,
) -> Result<AccessRightsSubjectResult<FieldRightSubject>, PassError> {
    let route = &field_route.route;
    let pointer = context.nodes.get(route.node)?.pointer.clone();
    let resource = match KnownRightSubjectRef::try_from(&right.subject)? {
        KnownRightSubjectRef::NoSubject(_) => {
            return Ok(AccessRightsSubjectResult::Resolved { subject: None });
        }
        KnownRightSubjectRef::Scope(subject) => {
            let scope_use = FieldScopeUse {
                field_route,
                field,
                right,
                pointer,
            };

            return Ok(scope_subject(
                reporter,
                catalogues,
                &scope_use,
                subject.scope.as_str(),
            )?);
        }
        KnownRightSubjectRef::Resource(subject) => subject,
    };
    let expected = access_rights_id_schema_of(catalogues, right, resource);
    let holders: Vec<&Property> = field
        .holder
        .properties
        .iter()
        .filter(|property| {
            access_rights_same_schema(&access_rights_property_schema(context, property), &expected)
        })
        .collect();
    let field_text = access_rights_field_text(field);
    let holder_text = access_rights_quoted(field.holder.id.as_str());
    let right_text = access_rights_quoted(right.id.as_str());

    if let [only] = holders.as_slice()
        && !only.optional
    {
        return Ok(AccessRightsSubjectResult::Resolved {
            subject: Some(FieldRightSubject {
                source: ValueSource {
                    r#in: ValueSourceIn::HolderField,
                    name: Some(only.name.clone()),
                    prefix_bits: None,
                },
            }),
        });
    }

    let message = match holders.as_slice() {
        [] => format!(
            "output field '{field_text}' of route '{}' is restricted to right '{right_text}', and its holder '{holder_text}' has no property of the right's id schema",
            route.id
        ),
        [only] => format!(
            "output field '{field_text}' of route '{}' is restricted to right '{right_text}', and the subject '{}' of its holder '{holder_text}' is optional: the subject must be a required field",
            route.id,
            access_rights_quoted(&only.name)
        ),
        several => {
            let names: Vec<String> = several
                .iter()
                .map(|property| format!("'{}'", access_rights_quoted(&property.name)))
                .collect();

            format!(
                "output field '{field_text}' of route '{}' is restricted to right '{right_text}', and its holder '{holder_text}' has several properties of the right's id schema: {}",
                route.id,
                names.join(", ")
            )
        }
    };

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::FieldRightSubject,
        message,
        fix: format!(
            "give '{holder_text}' exactly one required property of the right's id schema, or restrict the field to another right"
        ),
        pointer,
        distinct_by: Some(format!("{}{}", field.schema, field.pointer)),
        related: restricted_here(field)?,
    });

    Ok(AccessRightsSubjectResult::Refused)
}
