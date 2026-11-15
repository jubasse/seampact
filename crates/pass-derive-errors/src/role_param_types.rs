//! The typed check of a role binding's params: every param the template fills gets a value its
//! type use takes, whatever the role's data hold, and a required param gets one whenever the
//! binding answers.

use seampact_ir::{
    ArrayTemplate, EachTemplate, KnownTemplateRef, KnownTypeUseRef, ObjectSchema, ObjectTemplate,
    Refinements, ScalarType, ScalarTypeUse, SlotTemplate, Template, TextTemplate,
};
use seampact_json::JsonValue;
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::report::DeriveErrorsReporter;
use crate::role_param_fit::{DeriveErrorsFit, DeriveErrorsMisfitReason, DeriveErrorsTyped};
use crate::role_params::DeriveErrorsRoleParamsSite;

/// The checks of one binding: its site, the fit and the number of faults found so far.
pub(crate) struct TypedCheck<'check> {
    pub(crate) site: &'check DeriveErrorsRoleParamsSite<'check>,
    pub(crate) fit: DeriveErrorsFit<'check>,
    pub(crate) faults: usize,
}

/// Where a template stands: the top-level param it fills and its raw pointer.
#[derive(Debug, Clone)]
pub(crate) struct Position<'position> {
    pub(crate) param: String,
    pub(crate) pointer: String,
    /// The type use of the item `item` reads inside an `each`.
    pub(crate) item: Option<KnownTypeUseRef<'position>>,
}

/// The member a slot's path names that does not exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MissingSlotMember {
    pub(crate) datum: String,
    pub(crate) member: String,
}

/// The value a slot renders and whether it always has one; or the member its path names that does
/// not exist.
#[derive(Debug, Clone)]
pub(crate) enum SlotValue<'value> {
    Found {
        typed: DeriveErrorsTyped<'value>,
        always: bool,
    },
    Missing(MissingSlotMember),
}

/// A template that writes a list: written items or an `each`.
#[derive(Debug, Clone, Copy)]
pub(crate) enum ListTemplate<'template> {
    Array(&'template ArrayTemplate),
    Each(&'template EachTemplate),
}

/// The number of items a list template writes: the bounds it provably stays within.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ItemCounts {
    pub(crate) min: Option<usize>,
    pub(crate) max: Option<usize>,
}

/// The use a text template renders.
fn string_use() -> ScalarTypeUse {
    ScalarTypeUse {
        r#type: ScalarType::String,
        format: None,
        scalar: None,
        refinements: Refinements {
            min_length: None,
            max_length: None,
            pattern: None,
            minimum: None,
            maximum: None,
            exclusive_minimum: None,
            exclusive_maximum: None,
            multiple_of: None,
        },
        content: None,
        sensitive: None,
        nullable: None,
        docs: None,
        examples: None,
    }
}

/// Checks that the params a template renders validate against the code's params schema; `false`
/// when refused.
///
/// # Errors
///
/// A [`PassError`] when the template cannot be checked yet.
pub(crate) fn derive_errors_check_role_param_types(
    _site: &DeriveErrorsRoleParamsSite<'_>,
    _template: &Template,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deriveErrorsCheckRoleParamTypes"))
}

fn slot_value<'check>(
    _check: &TypedCheck<'check>,
    _position: &Position<'check>,
    _slot: &str,
    _path: &[String],
) -> Result<SlotValue<'check>, PassError> {
    Err(not_ported_yet("slotValue"))
}

fn refuse(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _message: String,
    _fix: String,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuse"))
}

fn refuse_type(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _what: &str,
    _reason: &DeriveErrorsMisfitReason,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseType"))
}

fn refuse_member(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _member: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseMember"))
}

fn refuse_unknown_path(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _value: &MissingSlotMember,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseUnknownPath"))
}

fn refuse_missing(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _member: &str,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("refuseMissing"))
}

/// Whether a template always renders a value (docs/ir/07: a slot without a value has none, and so
/// on up).
fn always_valued(
    _check: &TypedCheck<'_>,
    _position: &Position<'_>,
    _template: &KnownTemplateRef<'_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("alwaysValued"))
}

fn check_value(
    _check: &mut TypedCheck<'_>,
    _template: &KnownTemplateRef<'_>,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkValue"))
}

fn check_literal(
    _check: &mut TypedCheck<'_>,
    _value: &JsonValue,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkLiteral"))
}

fn check_slot(
    _check: &mut TypedCheck<'_>,
    _template: &SlotTemplate,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkSlot"))
}

fn check_text(
    _check: &mut TypedCheck<'_>,
    _template: &TextTemplate,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkText"))
}

fn check_object_value(
    _check: &mut TypedCheck<'_>,
    _template: &ObjectTemplate,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkObjectValue"))
}

// The number of items an array template writes, or an `each` maps from its array datum.
fn item_counts(
    _check: &TypedCheck<'_>,
    _template: ListTemplate<'_>,
    _position: &Position<'_>,
) -> Result<ItemCounts, PassError> {
    Err(not_ported_yet("itemCounts"))
}

fn check_array_value(
    _check: &mut TypedCheck<'_>,
    _template: ListTemplate<'_>,
    _accepted: &DeriveErrorsTyped<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkArrayValue"))
}

fn check_items(
    _check: &mut TypedCheck<'_>,
    _template: ListTemplate<'_>,
    _items: &KnownTypeUseRef<'_>,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkItems"))
}

fn check_object(
    _check: &mut TypedCheck<'_>,
    _template: &KnownTemplateRef<'_>,
    _schema: &ObjectSchema,
    _position: &Position<'_>,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkObject"))
}

// `$merge` of an object slot writes each member of its schema beside the written ones: each is
// checked as if written (located at the merge), and the required ones of a slot the role always
// supplies are filled.
fn check_merged(
    _check: &mut TypedCheck<'_>,
    _position: &Position<'_>,
    _template: &ObjectTemplate,
    _schema: &ObjectSchema,
    _reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("checkMerged"))
}
