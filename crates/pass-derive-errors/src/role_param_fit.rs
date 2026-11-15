//! Whether every value a role datum may hold fits a param's type use (docs/ir/07: the rendered
//! params validate against the code's params schema). The fit fails closed: a JSON type the use
//! does not take is refused, and so is a use carrying an enum, a format, a refinement, a union or
//! another object schema unless the datum's own use provably keeps within it (the same schema or
//! enum, an enum subset, the same format, refinements at least as narrow).

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_ir::{
    ArrayTypeUse, EnumTypeUse, IrMap, KnownSchemaRef, KnownTypeUseRef, ObjectSchema, Property,
    RefTypeUse, Refinements, ScalarTypeUse, Schema, SchemaId,
};
use seampact_pipeline::{PassError, TreeSchemaService};

use crate::not_ported::not_ported_yet;

/// What the fit reads: the draft's schemas and the example validator of tree.schemas.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsFit<'fit> {
    pub(crate) schemas: &'fit IrMap<SchemaId, Schema>,
    pub(crate) examples: &'fit dyn TreeSchemaService,
}

/// A use with whether JSON null is a value of it (a property holds its nullability beside its
/// use).
#[derive(Debug, Clone, Copy)]
pub(crate) struct DeriveErrorsTyped<'use_> {
    pub(crate) use_: KnownTypeUseRef<'use_>,
    pub(crate) nullable: bool,
}

/// A JSON type a rendered value may have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum DeriveErrorsJsonKind {
    String,
    Integer,
    Number,
    Boolean,
    Null,
    Array,
    Object,
}

/// The JSON types a use takes: any value, or the listed types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DeriveErrorsKinds {
    Any,
    Only(HashSet<DeriveErrorsJsonKind>),
}

/// Why a rendered value may not fit a param: `omittable` when the value may be left out where the
/// param requires it (the reporter files it as a missing required value), `misfit` for any other
/// value outside the param's type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveErrorsMisfitReason {
    pub(crate) kind: DeriveErrorsMisfitKind,
    pub(crate) text: String,
}

/// The two kinds of misfit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeriveErrorsMisfitKind {
    Misfit,
    Omittable,
}

/// A member of a rendered object that may not validate against the param's object schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveErrorsMemberMisfit {
    pub(crate) member: String,
    /// Set when the param's schema has no such member.
    pub(crate) lacking: bool,
    pub(crate) reason: DeriveErrorsMisfitReason,
}

/// The `omittable` reason: the value may be left out, but the param requires it.
const OMITTABLE_TEXT: &str = "it may be left out, but the param requires it";

/// The schema a ref names; tree.schemas writes every schema a use names, so a missing one is an
/// internal error.
///
/// # Errors
///
/// An internal error when the draft holds no such schema.
pub(crate) fn derive_errors_schema_of<'schemas>(
    schemas: &'schemas IrMap<SchemaId, Schema>,
    id: &SchemaId,
) -> Result<&'schemas Schema, InternalError> {
    schemas.get(id.as_str()).ok_or_else(|| {
        InternalError::new(format!(
            "the draft holds no schema {id}, which a type use names"
        ))
    })
}

/// The object schema a use names, if it names one.
///
/// # Errors
///
/// An internal error when the use names a schema the draft lacks or one this compiler does not
/// know.
pub(crate) fn derive_errors_object_of_use<'schemas>(
    schemas: &'schemas IrMap<SchemaId, Schema>,
    use_: &KnownTypeUseRef<'_>,
) -> Result<Option<&'schemas ObjectSchema>, InternalError> {
    let KnownTypeUseRef::Ref(reference) = use_ else {
        return Ok(None);
    };
    let schema = derive_errors_schema_of(schemas, &reference.schema)?;

    match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => Ok(Some(object)),
        KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_) => Ok(None),
    }
}

/// A reason of kind `misfit`.
pub(crate) fn derive_errors_misfit_reason(
    _text: String,
) -> Result<DeriveErrorsMisfitReason, PassError> {
    Err(not_ported_yet("deriveErrorsMisfitReason"))
}

fn misfit_or_none(text: Option<String>) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    text.map(derive_errors_misfit_reason).transpose()
}

// A reason about a part of the value (a member, an item) keeps that part's kind.
fn nested_reason(
    _prefix: &str,
    _reason: &DeriveErrorsMisfitReason,
) -> Result<DeriveErrorsMisfitReason, PassError> {
    Err(not_ported_yet("nestedReason"))
}

/// The JSON types a typed use takes.
pub(crate) fn derive_errors_kinds_of(
    _typed: &DeriveErrorsTyped<'_>,
) -> Result<DeriveErrorsKinds, PassError> {
    Err(not_ported_yet("deriveErrorsKindsOf"))
}

/// Whether every rendered JSON type is accepted.
pub(crate) fn derive_errors_kinds_fit(
    _rendered: &DeriveErrorsKinds,
    _accepted: &DeriveErrorsKinds,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deriveErrorsKindsFit"))
}

/// The JSON types as a message lists them.
pub(crate) fn derive_errors_describe_kinds(
    _kinds: &DeriveErrorsKinds,
) -> Result<String, PassError> {
    Err(not_ported_yet("deriveErrorsDescribeKinds"))
}

/// Why a value of `rendered` may not validate against `accepted`, or `None` when every such value
/// does.
pub(crate) fn derive_errors_misfit(
    fit: &DeriveErrorsFit<'_>,
    rendered: &DeriveErrorsTyped<'_>,
    accepted: &DeriveErrorsTyped<'_>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    typed_misfit(fit, rendered, accepted, &mut HashSet::new())
}

// `seen` holds the pairs of object schemas under comparison, so a recursive schema ends.
fn typed_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _rendered: &DeriveErrorsTyped<'_>,
    _accepted: &DeriveErrorsTyped<'_>,
    _seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    Err(not_ported_yet("typedMisfit"))
}

// The kinds fit; what the accepted use narrows beyond them.
fn constraint_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _rendered: &KnownTypeUseRef<'_>,
    _accepted: &KnownTypeUseRef<'_>,
    _seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    Err(not_ported_yet("constraintMisfit"))
}

fn enum_misfit(
    _rendered: &KnownTypeUseRef<'_>,
    _accepted: &EnumTypeUse,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("enumMisfit"))
}

fn describe_scalar(_use: &ScalarTypeUse) -> Result<String, PassError> {
    Err(not_ported_yet("describeScalar"))
}

fn scalar_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _rendered: &ScalarTypeUse,
    _accepted: &ScalarTypeUse,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("scalarMisfit"))
}

fn decimal_keeps(
    _fit: &DeriveErrorsFit<'_>,
    _value: &str,
    _refinements: &Refinements,
) -> Result<bool, PassError> {
    Err(not_ported_yet("decimalKeeps"))
}

fn refinements_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _rendered: &Refinements,
    _accepted: &Refinements,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("refinementsMisfit"))
}

fn array_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _rendered: &ArrayTypeUse,
    _accepted: &ArrayTypeUse,
    _seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    Err(not_ported_yet("arrayMisfit"))
}

fn ref_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _rendered: &KnownTypeUseRef<'_>,
    _accepted: &RefTypeUse,
    _seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    Err(not_ported_yet("refMisfit"))
}

/// The members of `source`, but `skipped` (written beside a merge), that may not validate against
/// `target`: one the target lacks, or one whose use does not fit.
pub(crate) fn derive_errors_member_misfits(
    _fit: &DeriveErrorsFit<'_>,
    _source: &ObjectSchema,
    _target: &ObjectSchema,
    _skipped: &HashSet<String>,
    _seen: &mut HashSet<String>,
) -> Result<Vec<DeriveErrorsMemberMisfit>, PassError> {
    Err(not_ported_yet("deriveErrorsMemberMisfits"))
}

fn member_misfit(
    _fit: &DeriveErrorsFit<'_>,
    _property: &Property,
    _accepted: &Property,
    _seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    Err(not_ported_yet("memberMisfit"))
}
