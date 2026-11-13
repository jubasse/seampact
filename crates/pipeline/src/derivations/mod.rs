//! The derivation table and the derivation roles of ADR 0006 sections 5 and 6, held as immutable
//! data.

mod roles;
mod table;

pub use roles::{
    DatumRequired, DerivationRole, EMPTY_BODY_SCHEMA_ID, ISSUE_SCHEMA_ID, IssueLocation,
    IssueMember, RoleDatum, derivation_datum_always, derivation_issue_members,
    derivation_param_of_datum, derivation_role_of, derivation_roles,
};
pub use table::{
    DERIVATION_TABLE, DerivationRoles, DerivationRow, PACK_DERIVATION_ROW, derivation_row_of,
    is_derivation_id,
};
