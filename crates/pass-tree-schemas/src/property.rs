//! A property the compiler writes itself (a core schema's field, a derived input's field): required
//! or optional, never nullable, sensitive or deprecated, with no docs or extensions.

use seampact_ir::{DerivedFrom, Docs, Extensions, Origin, Property, TypeUse};

/// The members a compiler-written property sets itself.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasWrittenProperty {
    pub(crate) name: String,
    pub(crate) type_use: TypeUse,
    pub(crate) optional: bool,
    pub(crate) origin: Origin,
    pub(crate) derived_from: Option<DerivedFrom>,
}

pub(crate) fn tree_schemas_derived_property(written: TreeSchemasWrittenProperty) -> Property {
    Property {
        name: written.name,
        r#type: written.type_use,
        optional: written.optional,
        nullable: false,
        sensitive: false,
        restricted_to: None,
        default: None,
        deprecated: false,
        code_name: None,
        docs: Docs::default(),
        extensions: Extensions::default(),
        origin: written.origin,
        derived_from: written.derived_from,
        examples: None,
    }
}
