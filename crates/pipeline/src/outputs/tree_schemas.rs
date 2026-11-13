//! The output of `tree.schemas`.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Enum, EnumId, ExtensionKeyDecl, ExtensionKeyId, IrMap, Scalar, ScalarId, Schema, SchemaId,
};

use super::merge::{Site, write_catalogue};
use crate::{DraftIr, Half, TreeSchemaService};

/// The draft members `tree.schemas` owns: the schema catalogues and the extension keys.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TreeSchemasMembers {
    /// The `schemas` catalogue.
    pub schemas: IrMap<SchemaId, Schema>,
    /// The `scalars` catalogue.
    pub scalars: IrMap<ScalarId, Scalar>,
    /// The `enums` catalogue.
    pub enums: IrMap<EnumId, Enum>,
    /// The `extensionKeys` catalogue.
    pub extension_keys: IrMap<ExtensionKeyId, ExtensionKeyDecl>,
}

impl TreeSchemasMembers {
    /// The draft fields this half writes, as ADR 0006 section 3 names them.
    pub const WRITES: &'static [&'static str] = &["schemas", "scalars", "enums", "extensionKeys"];

    /// Moves the catalogues into the draft, each still empty there.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] naming the catalogue when the draft already holds entries in it.
    pub fn merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError> {
        let site = Site::of_draft(Half::TreeSchemas);

        write_catalogue(&mut draft.schemas, self.schemas, "schemas", &site)?;
        write_catalogue(&mut draft.scalars, self.scalars, "scalars", &site)?;
        write_catalogue(&mut draft.enums, self.enums, "enums", &site)?;
        write_catalogue(
            &mut draft.extension_keys,
            self.extension_keys,
            "extensionKeys",
            &site,
        )
    }
}

/// What `tree.schemas` returns: its draft members and the schema service of every later half.
pub struct TreeSchemasOutput {
    /// The draft members.
    pub members: TreeSchemasMembers,
    /// The service later halves read type uses through.
    pub service: Box<dyn TreeSchemaService>,
}

impl TreeSchemasOutput {
    /// Splits the output so the members can be merged and the service kept for later halves.
    #[must_use]
    pub fn into_parts(self) -> (TreeSchemasMembers, Box<dyn TreeSchemaService>) {
        (self.members, self.service)
    }
}
