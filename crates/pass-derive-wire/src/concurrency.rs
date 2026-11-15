//! The version a write compares (`concurrency.version`, A33, ADR 0006 section 5). tree.nodes wrote
//! `version` and `field`. A body source is the version property tree.schemas added to the input, so
//! only `derivedFrom` is written here; a query or header source is a required parameter typed like
//! `field` on the resource's item. `header.If-Match` carries an entity tag instead: the `If-Match`
//! parameter and the `ETag` header of every success response carrying the item are strings. A relay
//! route has no resource of its own: its version parameter and `ETag` headers are those the public
//! operation derived, with that operation's `from`.

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivationId, DerivedFrom, QueryWire, ResponseShape, TypeUse, ValueSourceIn};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::tree_nodes_op_owner;
use seampact_pipeline::{PassError, TreeNode, TreeNodeKind};

use crate::not_ported::not_ported_yet;
use crate::params::{
    DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param,
    derive_wire_add_response_header, derive_wire_string_use, derive_wire_success_responses,
};
use crate::relayed::{DeriveWireRelayed, derive_wire_relayed_of};
use crate::routes::{DeriveWireRoute, DeriveWireScope, derive_wire_origin_at};

const CONCURRENCY: DerivationId = DerivationId::from_static("concurrency.version");

const IF_MATCH: &str = "if-match";

/// The entity tag response header of a versioned item and of `cache.etag`.
pub(crate) const DERIVE_WIRE_ETAG: &str = "ETag";

/// The type and wire of a version parameter.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveWireVersionParam {
    pub(crate) r#type: TypeUse,
    pub(crate) wire: Option<QueryWire>,
}

/// Writes the version parameter, the `ETag` header of an `If-Match` version, and
/// `concurrency.derivedFrom`.
///
/// # Errors
///
/// An internal error for a concurrency without a resource or a name, or
/// [`PassError::NotPortedYet`] until the relayed and version writers are ported.
pub(crate) fn derive_wire_concurrency(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if let Some(relayed) = derive_wire_relayed_of(route, scope)? {
        return derive_relayed_concurrency(route, &relayed, scope);
    }

    let operation = scope.operation_of(route.operation)?;

    write_item_entity_tag(route, scope)?;

    let Some(concurrency) = &operation.concurrency else {
        return Ok(());
    };
    let node = scope.node_of(route)?;
    let Some(resource) = resource_of(scope, node)? else {
        return Err(InternalError::new(format!(
            "tree.nodes wrote a concurrency on {}, which has no resource",
            node.pointer
        ))
        .into());
    };
    let mut from = vec![derive_wire_origin_at(
        scope,
        &format!("{}/concurrency", resource.pointer),
    )?];

    if node.pointer != resource.pointer && node.settings.contains_key("concurrency") {
        from.push(derive_wire_origin_at(
            scope,
            &format!("{}/concurrency", node.pointer),
        )?);
    }

    let derived_from = DerivedFrom {
        derivation: CONCURRENCY,
        from,
    };

    scope.output_of(route.operation)?.concurrency_derived_from = Some(derived_from.clone());

    let version = &concurrency.version;
    let place = match version.r#in {
        ValueSourceIn::Query => DeriveWireParamPlace::Query,
        ValueSourceIn::Header => DeriveWireParamPlace::Header,
        _ => return Ok(()),
    };
    let Some(name) = version.name.clone() else {
        return Err(InternalError::new(format!(
            "tree.nodes wrote a {} version without its name on '{}'",
            version.r#in, route.id
        ))
        .into());
    };

    if place == DeriveWireParamPlace::Header && name.to_lowercase() == IF_MATCH {
        return derive_wire_add_param(
            route,
            place,
            DeriveWireDerived {
                name,
                r#type: derive_wire_string_use(),
                required: true,
                derived_from,
                wire: None,
            },
            scope,
        );
    }

    let param = version_param(resource, &concurrency.field, scope)?;

    derive_wire_add_param(
        route,
        place,
        DeriveWireDerived {
            name,
            r#type: param.r#type,
            required: true,
            derived_from,
            wire: param.wire,
        },
        scope,
    )
}

fn derive_relayed_concurrency(
    _route: &DeriveWireRoute,
    _relayed: &DeriveWireRelayed<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("deriveRelayedConcurrency"))
}

// Each success response of the relay route carries the `ETag` the same response of the public
// operation carries.
fn write_relayed_entity_tags(
    _route: &DeriveWireRoute,
    _relayed: &DeriveWireRelayed<'_>,
    _scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("writeRelayedEntityTags"))
}

// Under a resource versioned by `If-Match`, every success response carrying its item writes the
// `ETag`, on the write and on every read of the resource alike.
fn write_item_entity_tag(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let node = scope.node_of(route)?;
    let Some(resource) = resource_of(scope, node)? else {
        return Ok(());
    };
    let Some(JsonValue::Object(declared)) = resource.settings.get("concurrency") else {
        return Ok(());
    };
    let Some(JsonValue::String(version)) = declared.get("version") else {
        return Ok(());
    };

    if version.to_lowercase() != format!("header.{IF_MATCH}") {
        return Ok(());
    }

    let item = item_schema_of(resource, scope)?;
    let derived = DeriveWireDerived {
        name: DERIVE_WIRE_ETAG.to_owned(),
        r#type: derive_wire_string_use(),
        required: true,
        derived_from: DerivedFrom {
            derivation: CONCURRENCY,
            from: vec![derive_wire_origin_at(
                scope,
                &format!("{}/concurrency", resource.pointer),
            )?],
        },
        wire: None,
    };
    let responses = scope.responses_of(route.operation)?;

    for position in derive_wire_success_responses(route, scope)? {
        let carries_item = responses.get(position).is_some_and(|response| {
            response.shape == ResponseShape::Item
                && matches!(&response.body, Some(TypeUse::Ref(body)) if item.as_deref() == Some(body.schema.as_str()))
        });

        if carries_item {
            derive_wire_add_response_header(route, position, &derived, None, scope)?;
        }
    }

    Ok(())
}

// The collection or single declaring the version: the owner of an op, else the route's nearest
// one.
fn resource_of<'run>(
    scope: &DeriveWireScope<'_, '_, 'run>,
    node: &TreeNode<'run>,
) -> Result<Option<&'run TreeNode<'run>>, InternalError> {
    let inherited = scope.context.inherited;
    let nodes = inherited.nodes();
    let mut resource = if node.kind == TreeNodeKind::Op {
        tree_nodes_op_owner(nodes, node)?
    } else {
        node.parent.map(|parent| nodes.get(parent)).transpose()?
    };

    while let Some(candidate) = resource {
        if matches!(
            candidate.kind,
            TreeNodeKind::Collection | TreeNodeKind::Single
        ) {
            break;
        }

        resource = candidate
            .parent
            .map(|parent| nodes.get(parent))
            .transpose()?;
    }

    Ok(resource)
}

fn item_schema_of(
    _resource: &TreeNode<'_>,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("itemSchemaOf"))
}

// The version parameter: typed like `field`, a query one with the wire tree.schemas gives that
// property.
fn version_param(
    _resource: &TreeNode<'_>,
    _field: &str,
    _scope: &DeriveWireScope<'_, '_, '_>,
) -> Result<DeriveWireVersionParam, PassError> {
    Err(not_ported_yet("versionParam"))
}
