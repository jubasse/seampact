//! The output of `access.rights`.

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Bucket, BucketId, DerivedFrom, FieldRight, FieldRightSubject, InputMediaType, InputProof,
    IrMap, OperationScope, Origin, Paging, Param, Requirement, Right, RightId, Rule, RuleId, Scope,
    ScopeId, TypeUse,
};
use seampact_json::JsonValue;

use super::element_owner::{ElementList, check_params};
use super::merge::{
    Site, existing, operations_with, write_catalogue, write_once, write_once_if_some,
};
use crate::{DraftIr, DraftOperationInput, Half};

/// The rights `access.rights` adds to one sort key `tree.nodes` declared.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SortKeyRights {
    /// The `right` member.
    pub right: Option<RightId>,
    /// The `params` member of the derived right.
    pub params: Option<JsonValue>,
    /// The `subject` member of the derived right.
    pub subject: Option<FieldRightSubject>,
    /// The `derivedFrom` member, carried with the derived right.
    pub derived_from: Option<DerivedFrom>,
}

/// The input `access.rights` writes for a body proof on a route that declares none.
#[derive(Debug, Clone, PartialEq)]
pub struct ProofOnlyInput {
    /// The `media` member.
    pub media: InputMediaType,
    /// The `schema` member, the core empty schema, with the `unknownKeys` a signed identity's route copies.
    pub schema: TypeUse,
    /// The `rawBody` member.
    pub raw_body: bool,
    /// The `proofs` member, the body fields of the rule proofs.
    pub proofs: Vec<InputProof>,
    /// The `origin` member: the first requirement that brings a body proof.
    pub origin: Origin,
}

/// What `access.rights` writes on one operation.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AccessRightsOperation {
    /// The `scopes` member.
    pub scopes: Vec<OperationScope>,
    /// The `requires` member.
    pub requires: Vec<Requirement>,
    /// The `fieldRights` member.
    pub field_rights: Vec<FieldRight>,
    /// The `filteredBy` member.
    pub filtered_by: Option<RightId>,
    /// The rule proof header parameters, appended to `params.header`.
    pub header_params: Vec<Param>,
    /// The `input.proofs` of a declared input.
    pub input_proofs: Option<Vec<InputProof>>,
    /// The proof-only input, a default field written only where the route declares none.
    pub proof_only_input: Option<ProofOnlyInput>,
    /// One entry per sort key of the operation's paging, in order; empty without paging.
    pub sort_keys: Vec<SortKeyRights>,
}

/// What `access.rights` writes: the rights catalogues and, per operation in draft order, the
/// requirements and derived rights.
#[derive(Debug, Clone, PartialEq)]
pub struct AccessRightsOutput {
    /// The `rights` catalogue.
    pub rights: IrMap<RightId, Right>,
    /// The `rules` catalogue.
    pub rules: IrMap<RuleId, Rule>,
    /// The `scopes` catalogue.
    pub scopes: IrMap<ScopeId, Scope>,
    /// The `buckets` catalogue.
    pub buckets: IrMap<BucketId, Bucket>,
    /// One entry per draft operation.
    pub operations: Vec<AccessRightsOperation>,
}

impl AccessRightsOutput {
    /// The draft fields this half writes, as ADR 0006 section 3 names them.
    pub const WRITES: &'static [&'static str] = &[
        "rights",
        "rules",
        "scopes",
        "buckets",
        "operations[].scopes",
        "operations[].requires",
        "operations[].fieldRights",
        "operations[].filteredBy",
        "operations[].params.header",
        "operations[].input.media",
        "operations[].input.schema",
        "operations[].input.schema.unknownKeys",
        "operations[].input.rawBody",
        "operations[].input.origin",
        "operations[].input.proofs",
        "operations[].paging.sortKeys[].right",
        "operations[].paging.sortKeys[].params",
        "operations[].paging.sortKeys[].subject",
        "operations[].paging.sortKeys[].derivedFrom",
    ];

    /// Moves the output into the draft.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] naming the member and the operation when the draft already holds a
    /// value there, when a list or the proofs have nothing to land on, when the sort keys do not
    /// match the paging's, or when the output has another number of operations than the draft.
    pub fn merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError> {
        let site = Site::of_draft(Half::AccessRights);

        write_catalogue(&mut draft.rights, self.rights, "rights", &site)?;
        write_catalogue(&mut draft.rules, self.rules, "rules", &site)?;
        write_catalogue(&mut draft.scopes, self.scopes, "scopes", &site)?;
        write_catalogue(&mut draft.buckets, self.buckets, "buckets", &site)?;

        for (operation, entry, site) in
            operations_with(&mut draft.operations, self.operations, Half::AccessRights)?
        {
            write_once(&mut operation.scopes, entry.scopes, "scopes", &site)?;
            write_once(&mut operation.requires, entry.requires, "requires", &site)?;
            write_once(
                &mut operation.field_rights,
                entry.field_rights,
                "fieldRights",
                &site,
            )?;
            write_once_if_some(
                &mut operation.filtered_by,
                entry.filtered_by,
                "filteredBy",
                &site,
            )?;

            if !entry.header_params.is_empty() {
                check_params(ElementList::HeaderParams, &entry.header_params, &site)?;

                let params = existing(&mut operation.params, "params", &site)?;

                params.header.extend(entry.header_params);
            }

            if let Some(input) = entry.proof_only_input {
                write_once(
                    &mut operation.input,
                    DraftOperationInput::from(input),
                    "input",
                    &site,
                )?;
            }

            if let Some(proofs) = entry.input_proofs {
                let input = existing(&mut operation.input, "input", &site)?;

                write_once(&mut input.proofs, proofs, "input.proofs", &site)?;
            }

            write_sort_key_rights(&mut operation.paging, entry.sort_keys, &site)?;
        }

        Ok(())
    }
}

impl From<ProofOnlyInput> for DraftOperationInput {
    fn from(input: ProofOnlyInput) -> Self {
        Self {
            media: input.media,
            schema: input.schema,
            body_limit_bytes: None,
            raw_body: Some(input.raw_body),
            fields: None,
            proofs: Some(input.proofs),
            origin: input.origin,
        }
    }
}

fn write_sort_key_rights(
    paging: &mut Option<Paging>,
    entries: Vec<SortKeyRights>,
    site: &Site,
) -> Result<(), InternalError> {
    let sort_keys = match paging {
        Some(paging) => paging.sort_keys.as_mut_slice(),
        None => &mut [],
    };

    if sort_keys.len() != entries.len() {
        return Err(InternalError::new(format!(
            "{}: {} sort key entries for {} declared sort keys",
            site.describe("paging.sortKeys"),
            entries.len(),
            sort_keys.len()
        )));
    }

    for (sort_key, entry) in sort_keys.iter_mut().zip(entries) {
        write_once_if_some(
            &mut sort_key.right,
            entry.right,
            "paging.sortKeys[].right",
            site,
        )?;
        write_once_if_some(
            &mut sort_key.params,
            entry.params,
            "paging.sortKeys[].params",
            site,
        )?;
        write_once_if_some(
            &mut sort_key.subject,
            entry.subject,
            "paging.sortKeys[].subject",
            site,
        )?;
        write_once_if_some(
            &mut sort_key.derived_from,
            entry.derived_from,
            "paging.sortKeys[].derivedFrom",
            site,
        )?;
    }

    Ok(())
}
