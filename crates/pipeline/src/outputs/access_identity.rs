//! The output of `access.identity`.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Access, Binding, CallerKind, Csrf, HeaderDecl, HeaderId, Identity, IdentityId, IrMap,
    PrincipalRequirement, Scheme, SchemeId, UnknownKeys,
};

use super::merge::{
    Site, existing, operations_with, write_catalogue, write_once, write_once_if_some,
    write_unknown_keys,
};
use crate::{DraftIr, Half};

/// What `access.identity` writes on one operation.
#[derive(Debug, Clone, PartialEq)]
pub struct AccessIdentityOperation {
    /// The `access` member.
    pub access: Access,
    /// The `callerKinds` member.
    pub caller_kinds: Vec<CallerKind>,
    /// The `principalRequires` member.
    pub principal_requires: Vec<PrincipalRequirement>,
    /// The `bindings` member.
    pub bindings: Vec<Binding>,
    /// The `csrf` member.
    pub csrf: Option<Csrf>,
    /// The `input.rawBody` member of a declared input, a default field.
    pub raw_body: Option<bool>,
    /// The `unknownKeys` of the input of a signed identity's route, a default field.
    pub unknown_keys: Option<UnknownKeys>,
}

/// What `access.identity` writes: the identity catalogues and, per operation in draft order, the
/// access members.
#[derive(Debug, Clone, PartialEq)]
pub struct AccessIdentityOutput {
    /// The `schemes` catalogue.
    pub schemes: IrMap<SchemeId, Scheme>,
    /// The `headers` catalogue.
    pub headers: IrMap<HeaderId, HeaderDecl>,
    /// The `identities` catalogue.
    pub identities: IrMap<IdentityId, Identity>,
    /// One entry per draft operation.
    pub operations: Vec<AccessIdentityOperation>,
}

impl AccessIdentityOutput {
    /// The draft fields this half writes, as ADR 0006 section 3 names them.
    pub const WRITES: &'static [&'static str] = &[
        "schemes",
        "headers",
        "identities",
        "operations[].access",
        "operations[].callerKinds",
        "operations[].principalRequires",
        "operations[].bindings",
        "operations[].csrf",
        "operations[].input.rawBody",
        "operations[].input.schema.unknownKeys",
    ];

    /// Moves the output into the draft.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] naming the member and the operation when the draft already holds a
    /// value there, when `rawBody` or `unknownKeys` has no declared input to land on, or when the
    /// output has another number of operations than the draft.
    pub fn merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError> {
        let site = Site::of_draft(Half::AccessIdentity);

        write_catalogue(&mut draft.schemes, self.schemes, "schemes", &site)?;
        write_catalogue(&mut draft.headers, self.headers, "headers", &site)?;
        write_catalogue(&mut draft.identities, self.identities, "identities", &site)?;

        for (operation, entry, site) in
            operations_with(&mut draft.operations, self.operations, Half::AccessIdentity)?
        {
            write_once(&mut operation.access, entry.access, "access", &site)?;
            write_once(
                &mut operation.caller_kinds,
                entry.caller_kinds,
                "callerKinds",
                &site,
            )?;
            write_once(
                &mut operation.principal_requires,
                entry.principal_requires,
                "principalRequires",
                &site,
            )?;
            write_once(&mut operation.bindings, entry.bindings, "bindings", &site)?;
            write_once_if_some(&mut operation.csrf, entry.csrf, "csrf", &site)?;

            if let Some(raw_body) = entry.raw_body {
                let input = existing(&mut operation.input, "input", &site)?;

                write_once(&mut input.raw_body, raw_body, "input.rawBody", &site)?;
            }

            write_unknown_keys(&mut operation.input, entry.unknown_keys, &site)?;
        }

        Ok(())
    }
}
