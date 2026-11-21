//! The core rules, one module each, in the order of the grammar table.

pub(crate) mod cookie_without_csrf;
pub(crate) mod credential_name;
pub(crate) mod not_found_role;
pub(crate) mod redundant_maturity;
pub(crate) mod subtree_exception;
pub(crate) mod unused_declaration;
