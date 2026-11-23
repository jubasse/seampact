//! The tag header of a header-tagged union input (`union.headerTag`, ADR 0003 section 3): a
//! required request header parameter. Its values are the union's tags, which the input's union
//! schema lists in `variants`; a header type use holds no inline value list, so the parameter is a
//! string and a target reads the values from that schema.

use seampact_diagnostics::InternalError;
use seampact_ir::{DerivedFrom, Schema, TypeUse, UnionTag, derivation_ids};

use crate::params::{
    DeriveWireDerived, DeriveWireParamPlace, derive_wire_add_param, derive_wire_string_use,
};
use crate::routes::{DeriveWireRoute, DeriveWireScope};

/// Writes the tag header parameter of a route whose whole input is a header-tagged union.
///
/// # Errors
///
/// An internal error from the parameter writer.
pub(crate) fn derive_wire_header_tag(
    route: &DeriveWireRoute,
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let operation = scope.operation_of(route.operation)?;
    let Some(TypeUse::Ref(reference)) = operation.input.as_ref().map(|input| &input.schema) else {
        return Ok(());
    };
    let draft = scope.draft;
    let Some(Schema::Union(union)) = draft.schemas.get(reference.schema.as_str()) else {
        return Ok(());
    };
    let UnionTag::Header(tag) = &union.tag else {
        return Ok(());
    };

    derive_wire_add_param(
        route,
        DeriveWireParamPlace::Header,
        DeriveWireDerived {
            name: tag.name.clone(),
            r#type: derive_wire_string_use(),
            required: true,
            derived_from: DerivedFrom {
                derivation: derivation_ids::UNION_HEADER_TAG,
                from: vec![union.origin.clone()],
            },
            wire: None,
        },
        scope,
    )
}
