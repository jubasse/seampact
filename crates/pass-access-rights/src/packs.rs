//! The rights a pack derives per route, and the entries that select them (ADR 0002 section 12).

use seampact_diagnostics::InternalError;
use seampact_ir::{IdentityId, Name, OpShorthand, OperationScope, PackRef, Right, RightSubject};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{PassError, TreeNodeId, UnionSetting, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::read::{
    access_rights_member, access_rights_object, access_rights_string, access_rights_strings,
};
use crate::report::AccessRightsReporter;
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{
    AccessRightsAccessKind, AccessRightsApi, AccessRightsRoute, access_rights_operation_of,
};
use crate::schema_use::AccessRightsContext;

/// One `derive` entry of a pack, with the pointer it is written at.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsDeriveEntry<'run> {
    pub(crate) pointer: String,
    pub(crate) entry: String,
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
            entry: entry.to_owned(),
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

pub(crate) fn access_rights_expand(
    _reporter: &mut AccessRightsReporter,
    _template: &AccessRightsTemplate,
    _route: &AccessRightsRoute,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("accessRightsExpand"))
}

pub(crate) fn access_rights_declare_right(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _catalogues: &mut AccessRightsCatalogues,
    _input: &DerivedRightInput<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsDeclareRight"))
}

pub(crate) fn check_same_subject(
    _reporter: &mut AccessRightsReporter,
    _options: &SameSubjectCheck<'_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkSameSubject"))
}

pub(crate) fn derived_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _input: &DerivedSubjectInput<'_, '_>,
) -> Result<Option<AccessRightsDerivedSubject>, PassError> {
    Err(not_ported_yet("derivedSubject"))
}

pub(crate) fn resource_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _options: &PackResourceInput<'_>,
) -> Result<Option<AccessRightsDerivedSubject>, PassError> {
    Err(not_ported_yet("resourceSubject"))
}

pub(crate) fn item_name(
    _context: &AccessRightsContext,
    _schemas: &AccessRightsDraftSchemas,
    _item: &JsonValue,
    _pointer: &str,
) -> Result<Name, PassError> {
    Err(not_ported_yet("itemName"))
}
