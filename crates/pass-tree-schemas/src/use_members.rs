//! The members every kind of type use holds (`nullable`, `docs`, `examples`), read and written
//! without a match on the kind at each call.

use seampact_diagnostics::InternalError;
use seampact_ir::{Docs, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

/// The members shared by every type use the IR knows, borrowed for writing.
pub(crate) struct UseMembers<'use_> {
    pub(crate) nullable: &'use_ mut Option<bool>,
    pub(crate) docs: &'use_ mut Option<Docs>,
    pub(crate) examples: &'use_ mut Option<Vec<JsonValue>>,
}

/// The shared members of a type use.
///
/// # Errors
///
/// An [`InternalError`] for a use of a kind this IR revision does not know, which the half never
/// builds.
pub(crate) fn use_members(schema_use: &mut TypeUse) -> Result<UseMembers<'_>, PassError> {
    match schema_use {
        TypeUse::Ref(reference) => Ok(UseMembers {
            nullable: &mut reference.nullable,
            docs: &mut reference.docs,
            examples: &mut reference.examples,
        }),
        TypeUse::Opaque(opaque) => Ok(UseMembers {
            nullable: &mut opaque.nullable,
            docs: &mut opaque.docs,
            examples: &mut opaque.examples,
        }),
        TypeUse::File(file) => Ok(UseMembers {
            nullable: &mut file.nullable,
            docs: &mut file.docs,
            examples: &mut file.examples,
        }),
        TypeUse::Enum(enum_use) => Ok(UseMembers {
            nullable: &mut enum_use.nullable,
            docs: &mut enum_use.docs,
            examples: &mut enum_use.examples,
        }),
        TypeUse::Scalar(scalar) => Ok(UseMembers {
            nullable: &mut scalar.nullable,
            docs: &mut scalar.docs,
            examples: &mut scalar.examples,
        }),
        TypeUse::Array(array) => Ok(UseMembers {
            nullable: &mut array.nullable,
            docs: &mut array.docs,
            examples: &mut array.examples,
        }),
        TypeUse::Unknown(_) => Err(InternalError::new(
            "tree.schemas holds a type use of a kind this IR revision does not know".to_owned(),
        )
        .into()),
    }
}
