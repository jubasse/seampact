//! The rights a pack derives per route, and the entries that select them (ADR 0002 section 12).

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    DerivationId, DerivedFrom, Direction, Docs, ErrorCode, Extensions, IdentityId,
    KnownRightSubject, KnownSchemaRef, KnownTypeUseRef, Name, NoSubject, OpShorthand,
    OperationScope, PackRef, ResourceSubject, Right, RightId, RightSubject, ScopeSubject,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{PassError, TreeNodeId, UnionSetting, pointer_below};

use crate::catalogues::{
    AccessRightsCatalogues, AccessRightsNameCheck, access_rights_check_name,
    access_rights_right_errors, schema_name_of,
};
use crate::read::{
    access_rights_member, access_rights_object, access_rights_origin_of, access_rights_schema_name,
    access_rights_string, access_rights_strings,
};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{
    AccessRightsAccessKind, AccessRightsApi, AccessRightsRoute, access_rights_operation_of,
    access_rights_resource_of, access_rights_scope_of,
};
use crate::schema_use::{AccessRightsContext, access_rights_type_use};

/// One `derive` entry of a pack, with the pointer it is written at.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsDeriveEntry<'run> {
    pub(crate) pointer: String,
    pub(crate) derivation: String,
    pub(crate) settings: &'run JsonObject,
}

/// What one derived right is built from.
#[derive(Debug, Clone)]
pub(crate) struct DerivedRightInput<'run, 'draft> {
    pub(crate) entry: &'draft AccessRightsDeriveEntry<'run>,
    pub(crate) route: &'draft AccessRightsRoute,
    pub(crate) scopes: &'draft [OperationScope],
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
}

/// What `derivedSubject` reads besides a [`DerivedRightInput`].
#[derive(Debug, Clone)]
pub(crate) struct DerivedSubjectInput<'run, 'draft> {
    pub(crate) input: DerivedRightInput<'run, 'draft>,
    pub(crate) declare_right: Option<&'run JsonValue>,
    pub(crate) pointer: String,
}

/// A template text with the pointer it is written at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsTemplate {
    pub(crate) text: String,
    pub(crate) pointer: String,
}

/// A derived right's subject with the schema name of its id, when it names one.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsDerivedSubject {
    pub(crate) subject: RightSubject,
    pub(crate) id_name: Option<String>,
}

/// What `checkSameSubject` compares: the derived subject with the right already declared.
#[derive(Debug, Clone)]
pub(crate) struct SameSubjectCheck<'derived> {
    pub(crate) id: String,
    pub(crate) present: &'derived Right,
    pub(crate) derived: &'derived RightSubject,
    pub(crate) pointer: String,
    pub(crate) route: &'derived AccessRightsRoute,
}

/// What `resourceSubject` reads of the node a pack right is derived at.
#[derive(Debug, Clone)]
pub(crate) struct PackResourceInput<'draft> {
    pub(crate) at: TreeNodeId,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) pointer: String,
    pub(crate) route: &'draft AccessRightsRoute,
}

/// The layer prefix of a pack's origin.
const PACK_LAYER: &str = "pack:";

const RESOURCE_SLOT: &str = "{resource}";

const OP_SLOT: &str = "{op}";

/// The derive entries of the api, in application order: the packs in order, each pack's entries
/// in written order. Each pack must be one `tree.nodes` recorded in `packs`, since the derivation
/// id names it.
///
/// # Errors
///
/// An internal error for an entry of no pack, of an unrecorded pack, or with no `entry` name.
pub(crate) fn access_rights_derive_entries<'run>(
    context: &AccessRightsContext<'_, '_, 'run>,
    packs: &[PackRef],
) -> Result<Vec<AccessRightsDeriveEntry<'run>>, InternalError> {
    let raw = context.context.raw;
    let Some(JsonValue::Array(written)) = access_rights_member(Some(&raw.merged), "derive") else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::new();

    for (index, settings) in written.iter().enumerate() {
        let Some(settings) = access_rights_object(Some(settings)) else {
            continue;
        };
        let pointer = pointer_below("/derive", &[&index.to_string()]);
        let layer = context
            .context
            .origin(&pointer)
            .map_or_else(String::new, |origin| origin.layer.to_string());
        let Some(pack) = layer.strip_prefix(PACK_LAYER) else {
            return Err(InternalError::new(format!(
                "the derive entry at {pointer} comes from layer '{layer}', which is no pack"
            )));
        };

        if !packs.iter().any(|applied| applied.name == pack) {
            return Err(InternalError::new(format!(
                "the derive entry at {pointer} comes from pack '{pack}', which tree.nodes did not record in packs"
            )));
        }

        let Some(entry) = access_rights_string(Some(settings), "entry") else {
            return Err(InternalError::new(format!(
                "the derive entry at {pointer} has no 'entry' name"
            )));
        };

        entries.push(AccessRightsDeriveEntry {
            derivation: format!("pack.{pack}.{entry}"),
            pointer,
            settings,
        });
    }

    Ok(entries)
}

/// True when the route matches every criterion of the entry's selector (ADR 0002 section 2).
///
/// # Errors
///
/// An internal error from the inherited-setting reader or for a route of another draft.
pub(crate) fn access_rights_selects(
    context: &AccessRightsContext,
    entry: &AccessRightsDeriveEntry<'_>,
    route: &AccessRightsRoute,
    api: &AccessRightsApi,
) -> Result<bool, InternalError> {
    let select = access_rights_object(access_rights_member(Some(entry.settings), "select"));
    let accepts = |criterion: &str, value: Option<&str>| -> bool {
        if access_rights_member(select, criterion).is_none() {
            return true;
        }

        value.is_some_and(|value| {
            access_rights_strings(select, criterion)
                .iter()
                .any(|accepted| accepted == value)
        })
    };
    let inherited = context.context.inherited;
    let tags: Vec<&JsonValue> = inherited
        .union(route.node, UnionSetting::Tags)?
        .unwrap_or_default()
        .into_iter()
        .map(|tag| tag.value)
        .collect();
    let tag_accepted = access_rights_member(select, "tag").is_none()
        || access_rights_strings(select, "tag").iter().any(|wanted| {
            tags.iter()
                .any(|tag| matches!(tag, JsonValue::String(text) if text == wanted))
        });
    let operation = access_rights_operation_of(context, route)?;
    let access = if operation.safe == Some(true) {
        "read"
    } else {
        "write"
    };
    let identity = match route.access {
        AccessRightsAccessKind::Public => None,
        AccessRightsAccessKind::Identity | AccessRightsAccessKind::Optional => {
            route.identity.as_ref().map(IdentityId::as_str)
        }
    };

    Ok(
        accepts("op", operation.op.as_ref().map(OpShorthand::as_str))
            && accepts("access", Some(access))
            && accepts("apiKind", Some(&api.kind))
            && accepts("identity", identity)
            && tag_accepted,
    )
}

/// A template over `{resource}` (the collection or single the route belongs to) and `{op}` (the
/// `ops` name, else the route's name), expanded for a route; `None` after an error.
pub(crate) fn access_rights_expand(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    template: &AccessRightsTemplate,
    route: &AccessRightsRoute,
) -> Result<Option<String>, PassError> {
    let resource = match access_rights_resource_of(&context.nodes, route.node)? {
        Some(collection) => Some(context.nodes.get(collection)?.name.as_str()),
        None => None,
    };

    if resource.is_none() && template.text.contains(RESOURCE_SLOT) {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::PackTemplate,
            message: format!(
                "the template '{}' reads {{resource}}, and route '{}' belongs to no collection or single",
                access_rights_quoted(&template.text),
                route.id
            ),
            fix: "narrow the entry's selector to routes of a collection or single, or drop {resource}".to_owned(),
            pointer: template.pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    }

    let operation = access_rights_operation_of(context, route)?;
    let op = match &operation.op {
        Some(shorthand) => shorthand.as_str(),
        None => context.nodes.get(route.node)?.name.as_str(),
    };

    // A replacement string is never read as a pattern: `$` in a name stays literal.
    Ok(Some(
        template
            .text
            .replace(RESOURCE_SLOT, resource.unwrap_or(""))
            .replace(OP_SLOT, op),
    ))
}

/// Applies an entry's `declareRight` to a route: the right its name template gives, added to the
/// catalogue with `derivedFrom`, or, when the catalogue already declares that name, checked
/// against the subject the entry gives.
pub(crate) fn access_rights_declare_right(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &mut AccessRightsCatalogues,
    input: &DerivedRightInput<'_, '_>,
) -> Result<(), PassError> {
    let DerivedRightInput { entry, route, .. } = input;
    let declare_right = access_rights_member(Some(entry.settings), "declareRight");
    let pointer = pointer_below(&entry.pointer, &["declareRight"]);
    let Some(text) = access_rights_string(access_rights_object(declare_right), "name") else {
        return Err(InternalError::new(format!(
            "the declareRight at {pointer} has no 'name' template"
        ))
        .into());
    };
    let Some(id) = access_rights_expand(
        context,
        reporter,
        &AccessRightsTemplate {
            text: text.to_owned(),
            pointer: pointer_below(&pointer, &["name"]),
        },
        route,
    )?
    else {
        return Ok(());
    };
    let Some(derived) = derived_subject(
        context,
        reporter,
        &DerivedSubjectInput {
            input: input.clone(),
            declare_right,
            pointer: pointer.clone(),
        },
    )?
    else {
        if !catalogues.rights.contains_key(id.as_str()) {
            catalogues.declared.rights.insert(id);
        }

        return Ok(());
    };

    if let Some(present) = catalogues.rights.get(id.as_str()) {
        check_same_subject(
            reporter,
            &SameSubjectCheck {
                id: id.clone(),
                present,
                derived: &derived.subject,
                pointer,
                route,
            },
        );

        if let Some(derived_from) = catalogues
            .rights
            .get_mut(id.as_str())
            .and_then(|right| right.derived_from.as_mut())
            && derived_from.derivation.as_str() == entry.derivation
        {
            derived_from
                .from
                .push(context.nodes.get(route.node)?.origin.clone());
        }

        return Ok(());
    }

    if catalogues.declared.rights.contains(&id) {
        return Ok(());
    }

    let named = access_rights_check_name(
        reporter,
        &AccessRightsNameCheck {
            id: id.clone(),
            code_name: None,
            pointer: pointer.clone(),
            right_pattern: catalogues.right_pattern.as_ref(),
        },
    )?;

    if !named {
        catalogues.declared.rights.insert(id);

        return Ok(());
    }

    let right = derived_right_of(
        context,
        catalogues,
        input,
        declare_right,
        &pointer,
        &id,
        derived.subject,
    )?;

    catalogues.rights.insert(RightId::new(id.clone()), right);

    if let Some(id_name) = derived.id_name {
        catalogues.right_id_names.insert(id, id_name);
    }

    Ok(())
}

// The right an entry derives for a route: declared at the entry, derived from it and the route.
fn derived_right_of(
    context: &AccessRightsContext,
    catalogues: &AccessRightsCatalogues,
    input: &DerivedRightInput<'_, '_>,
    declare_right: Option<&JsonValue>,
    pointer: &str,
    id: &str,
    subject: RightSubject,
) -> Result<Right, PassError> {
    let right_origin = access_rights_origin_of(context, pointer)?;
    let errors = access_rights_right_errors(
        access_rights_object(declare_right),
        &catalogues.forbidden_code,
    );

    Ok(Right {
        id: RightId::new(id.to_owned()),
        params: None,
        subject,
        guest: None,
        errors: errors.into_iter().map(ErrorCode::new).collect(),
        docs: Docs::default(),
        extensions: Extensions::default(),
        origin: right_origin.clone(),
        derived_from: Some(DerivedFrom {
            derivation: DerivationId::new(input.entry.derivation.clone()),
            from: vec![
                right_origin,
                context.nodes.get(input.route.node)?.origin.clone(),
            ],
        }),
        code_name: None,
    })
}

pub(crate) fn check_same_subject(
    reporter: &mut AccessRightsReporter,
    options: &SameSubjectCheck<'_>,
) {
    let SameSubjectCheck {
        id,
        present,
        derived,
        pointer,
        route,
    } = options;

    // Equality of IR values ignores object member order, as the canonical text does.
    if present.subject == **derived {
        return;
    }

    // A right an entry derived has no place of its own in the merged tree; a declared one does.
    let related = if present.derived_from.is_none() {
        vec![AccessRightsRelated {
            pointer: pointer_below("/rights", &[id]),
            message: "the right is declared here".to_owned(),
        }]
    } else {
        Vec::new()
    };

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::PackRight,
        message: format!(
            "right '{id}' has a {} subject, and the entry derives another {} subject for route '{}'",
            present.subject.tag(),
            derived.tag(),
            route.id
        ),
        fix: "give the right the subject the entry derives, or narrow the entry's selector"
            .to_owned(),
        pointer: pointer.clone(),
        distinct_by: None,
        related,
    });
}

// `subject.member` on a route of a collection's member scope, `subject.collection` elsewhere;
// absent is `none`.
pub(crate) fn derived_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    input: &DerivedSubjectInput<'_, '_>,
) -> Result<Option<AccessRightsDerivedSubject>, PassError> {
    let DerivedSubjectInput {
        input:
            DerivedRightInput {
                route,
                scopes,
                schemas,
                ..
            },
        declare_right,
        pointer,
    } = input;
    let subject = access_rights_object(access_rights_member(
        access_rights_object(*declare_right),
        "subject",
    ));
    let none = || {
        Some(AccessRightsDerivedSubject {
            subject: KnownRightSubject::NoSubject(NoSubject {}).into(),
            id_name: None,
        })
    };

    if let Some(at) = access_rights_scope_of(&context.nodes, route.node)?
        && context.nodes.get(at.scope)?.name == "member"
    {
        if access_rights_string(subject, "member") != Some("resource") {
            return Ok(none());
        }

        return resource_subject(
            context,
            reporter,
            &PackResourceInput {
                at: at.collection,
                schemas,
                pointer: pointer.clone(),
                route,
            },
        );
    }

    if access_rights_string(subject, "collection") != Some("innermostScope") {
        return Ok(none());
    }

    // The innermost scope when the route has one, none otherwise.
    let Some(innermost) = scopes.last() else {
        return Ok(none());
    };

    Ok(Some(AccessRightsDerivedSubject {
        subject: KnownRightSubject::Scope(ScopeSubject {
            scope: innermost.scope.clone(),
        })
        .into(),
        id_name: None,
    }))
}

// The item schema of the collection with its member id (ADR 0002 section 2, `subject.member:
// resource`).
pub(crate) fn resource_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    options: &PackResourceInput<'_>,
) -> Result<Option<AccessRightsDerivedSubject>, PassError> {
    let PackResourceInput {
        at,
        schemas,
        pointer,
        route,
    } = options;
    let collection = context.nodes.get(*at)?;
    let ids = access_rights_object(access_rights_member(Some(collection.settings), "id"));
    let id_keys: Vec<&String> = ids
        .map(|written| written.keys().collect())
        .unwrap_or_default();
    let item = access_rights_member(Some(collection.settings), "item");

    let (&[id_key], Some(item)) = (id_keys.as_slice(), item) else {
        reporter.error(AccessRightsProblem {
            rule: AccessRightsRule::PackRight,
            message: format!(
                "the entry derives a resource right for route '{}', and collection '{}' has no item with one member id",
                route.id, collection.name
            ),
            fix: "give the collection an 'item' and one 'id', or narrow the entry's selector".to_owned(),
            pointer: pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    };
    let id_pointer = pointer_below(&collection.pointer, &["id", id_key]);
    let id_name = access_rights_schema_name(access_rights_member(ids, id_key));

    Ok(Some(AccessRightsDerivedSubject {
        subject: KnownRightSubject::Resource(ResourceSubject {
            r#type: item_name(
                context,
                schemas,
                item,
                &pointer_below(&collection.pointer, &["item"]),
            )?,
            id_schema: access_rights_type_use(context, &id_pointer, &Direction::Input)?,
        })
        .into(),
        id_name,
    }))
}

// A named item is its schema name; an inline one takes the name tree.schemas gave its hoisted
// schema.
pub(crate) fn item_name(
    context: &AccessRightsContext,
    schemas: &AccessRightsDraftSchemas,
    item: &JsonValue,
    pointer: &str,
) -> Result<Name, PassError> {
    if let Some(name) = access_rights_schema_name(Some(item)) {
        return Ok(schema_name_of(&name));
    }

    let type_use = access_rights_type_use(context, pointer, &Direction::Output)?;
    let hoisted = match KnownTypeUseRef::try_from(&type_use)? {
        KnownTypeUseRef::Ref(reference) => schemas.get(reference.schema.as_str()),
        KnownTypeUseRef::Array(_)
        | KnownTypeUseRef::Scalar(_)
        | KnownTypeUseRef::Enum(_)
        | KnownTypeUseRef::File(_)
        | KnownTypeUseRef::Opaque(_) => None,
    };
    let Some(hoisted) = hoisted else {
        return Err(InternalError::new(format!(
            "the schema service answers no named schema for the item at {pointer}"
        ))
        .into());
    };

    Ok(match KnownSchemaRef::try_from(hoisted)? {
        KnownSchemaRef::Object(object) => object.name.clone(),
        KnownSchemaRef::Map(map) => map.name.clone(),
        KnownSchemaRef::Union(union) => union.name.clone(),
    })
}
