//! Whether every value a role datum may hold fits a param's type use (docs/ir/07: the rendered
//! params validate against the code's params schema). The fit fails closed: a JSON type the use
//! does not take is refused, and so is a use carrying an enum, a format, a refinement, a union or
//! another object schema unless the datum's own use provably keeps within it (the same schema or
//! enum, an enum subset, the same format, refinements at least as narrow).

use std::collections::HashSet;

use seampact_diagnostics::InternalError;
use seampact_diagnostics::quote_text;
use seampact_ir::{
    ArrayTypeUse, DecimalLiteral, EnumTypeUse, IrMap, KnownSchemaRef, KnownTypeUseRef,
    ObjectSchema, Property, RefTypeUse, Refinements, ScalarType, ScalarTypeUse, Schema, SchemaId,
    SchemaRef, TypeUse,
};
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaService};

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

impl DeriveErrorsJsonKind {
    /// The kind as a message and the TypeScript union write it.
    const fn as_str(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Integer => "integer",
            Self::Number => "number",
            Self::Boolean => "boolean",
            Self::Null => "null",
            Self::Array => "array",
            Self::Object => "object",
        }
    }
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

/// A copy of the use a closed form borrows, as the open union the example validator reads.
pub(crate) fn derive_errors_copied_use(use_: &KnownTypeUseRef<'_>) -> TypeUse {
    match use_ {
        KnownTypeUseRef::Opaque(opaque) => TypeUse::Opaque((*opaque).clone()),
        KnownTypeUseRef::File(file) => TypeUse::File((*file).clone()),
        KnownTypeUseRef::Enum(enum_use) => TypeUse::Enum((*enum_use).clone()),
        KnownTypeUseRef::Array(array) => TypeUse::Array((*array).clone()),
        KnownTypeUseRef::Scalar(scalar) => TypeUse::Scalar((*scalar).clone()),
        KnownTypeUseRef::Ref(reference) => TypeUse::Ref((*reference).clone()),
    }
}

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
pub(crate) const fn derive_errors_misfit_reason(text: String) -> DeriveErrorsMisfitReason {
    DeriveErrorsMisfitReason {
        kind: DeriveErrorsMisfitKind::Misfit,
        text,
    }
}

fn omittable_reason() -> DeriveErrorsMisfitReason {
    DeriveErrorsMisfitReason {
        kind: DeriveErrorsMisfitKind::Omittable,
        text: OMITTABLE_TEXT.to_owned(),
    }
}

fn misfit_or_none(text: Option<String>) -> Option<DeriveErrorsMisfitReason> {
    text.map(derive_errors_misfit_reason)
}

// A reason about a part of the value (a member, an item) keeps that part's kind.
fn nested_reason(prefix: &str, reason: &DeriveErrorsMisfitReason) -> DeriveErrorsMisfitReason {
    DeriveErrorsMisfitReason {
        kind: reason.kind,
        text: format!("{prefix}{}", reason.text),
    }
}

/// The use that names the schema `id`, as a param's type.
pub(crate) fn derive_errors_ref_use(id: &SchemaRef) -> TypeUse {
    TypeUse::Ref(RefTypeUse {
        schema: id.clone(),
        unknown_keys: None,
        nullable: None,
        docs: None,
        examples: None,
    })
}

/// A scalar use of one type, an optional format and the given refinements, nothing else set.
pub(crate) fn derive_errors_scalar_use(
    scalar_type: ScalarType,
    format: Option<&str>,
    refinements: Refinements,
) -> ScalarTypeUse {
    ScalarTypeUse {
        r#type: scalar_type,
        format: format.map(str::to_owned),
        scalar: None,
        refinements,
        content: None,
        sensitive: None,
        nullable: None,
        docs: None,
        examples: None,
    }
}

/// Refinements that bound nothing.
pub(crate) const fn derive_errors_no_refinements() -> Refinements {
    Refinements {
        min_length: None,
        max_length: None,
        pattern: None,
        minimum: None,
        maximum: None,
        exclusive_minimum: None,
        exclusive_maximum: None,
        multiple_of: None,
    }
}

/// The JSON types a typed use takes.
///
/// # Errors
///
/// An internal error when a scalar use has a type this compiler does not know.
pub(crate) fn derive_errors_kinds_of(
    typed: &DeriveErrorsTyped<'_>,
) -> Result<DeriveErrorsKinds, InternalError> {
    let use_nullable = match &typed.use_ {
        KnownTypeUseRef::Opaque(_) => return Ok(DeriveErrorsKinds::Any),
        KnownTypeUseRef::File(file) => file.nullable,
        KnownTypeUseRef::Enum(enum_use) => enum_use.nullable,
        KnownTypeUseRef::Array(array) => array.nullable,
        KnownTypeUseRef::Scalar(scalar) => scalar.nullable,
        KnownTypeUseRef::Ref(reference) => reference.nullable,
    };
    let mut kinds = HashSet::new();

    if typed.nullable || use_nullable == Some(true) {
        kinds.insert(DeriveErrorsJsonKind::Null);
    }

    match &typed.use_ {
        KnownTypeUseRef::Opaque(_) | KnownTypeUseRef::File(_) => {}
        KnownTypeUseRef::Enum(_) => {
            kinds.insert(DeriveErrorsJsonKind::String);
        }
        KnownTypeUseRef::Array(_) => {
            kinds.insert(DeriveErrorsJsonKind::Array);
        }
        KnownTypeUseRef::Scalar(scalar) => {
            let kind = match scalar.r#type {
                ScalarType::String => DeriveErrorsJsonKind::String,
                ScalarType::Integer => DeriveErrorsJsonKind::Integer,
                ScalarType::Number => {
                    kinds.insert(DeriveErrorsJsonKind::Integer);

                    DeriveErrorsJsonKind::Number
                }
                ScalarType::Boolean => DeriveErrorsJsonKind::Boolean,
                ScalarType::Unknown(ref unknown) => {
                    return Err(InternalError::new(format!(
                        "a scalar use has the type {unknown}, which this compiler does not know"
                    )));
                }
            };

            kinds.insert(kind);
        }
        // A union's variants are object schemas, so a union use takes an object, never an array
        // or a scalar.
        KnownTypeUseRef::Ref(_) => {
            kinds.insert(DeriveErrorsJsonKind::Object);
        }
    }

    Ok(DeriveErrorsKinds::Only(kinds))
}

/// Whether every rendered JSON type is accepted.
pub(crate) fn derive_errors_kinds_fit(
    rendered: &DeriveErrorsKinds,
    accepted: &DeriveErrorsKinds,
) -> bool {
    match (rendered, accepted) {
        (_, DeriveErrorsKinds::Any) => true,
        (DeriveErrorsKinds::Any, DeriveErrorsKinds::Only(_)) => false,
        (DeriveErrorsKinds::Only(rendered), DeriveErrorsKinds::Only(accepted)) => {
            rendered.iter().all(|kind| accepted.contains(kind))
        }
    }
}

/// The JSON types as a message lists them.
pub(crate) fn derive_errors_describe_kinds(kinds: &DeriveErrorsKinds) -> String {
    let DeriveErrorsKinds::Only(kinds) = kinds else {
        return "any JSON value".to_owned();
    };
    let mut names: Vec<&str> = kinds.iter().map(|kind| kind.as_str()).collect();

    names.sort_by(|left, right| cmp_utf16(left, right));

    names.join(" or ")
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
    fit: &DeriveErrorsFit<'_>,
    rendered: &DeriveErrorsTyped<'_>,
    accepted: &DeriveErrorsTyped<'_>,
    seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    let rendered_kinds = derive_errors_kinds_of(rendered)?;
    let accepted_kinds = derive_errors_kinds_of(accepted)?;

    if !derive_errors_kinds_fit(&rendered_kinds, &accepted_kinds) {
        let reason = derive_errors_misfit_reason(format!(
            "the param's type ({}) does not take {}",
            derive_errors_describe_kinds(&accepted_kinds),
            derive_errors_describe_kinds(&rendered_kinds)
        ));

        return Ok(Some(reason));
    }

    constraint_misfit(fit, &rendered.use_, &accepted.use_, seen)
}

// The kinds fit; what the accepted use narrows beyond them.
fn constraint_misfit(
    fit: &DeriveErrorsFit<'_>,
    rendered: &KnownTypeUseRef<'_>,
    accepted: &KnownTypeUseRef<'_>,
    seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    match (accepted, rendered) {
        (KnownTypeUseRef::Array(accepted), KnownTypeUseRef::Array(rendered)) => {
            array_misfit(fit, rendered, accepted, seen)
        }
        (KnownTypeUseRef::Opaque(_) | KnownTypeUseRef::File(_) | KnownTypeUseRef::Array(_), _) => {
            Ok(None)
        }
        (KnownTypeUseRef::Enum(accepted), _) => Ok(misfit_or_none(enum_misfit(rendered, accepted))),
        (KnownTypeUseRef::Scalar(accepted), KnownTypeUseRef::Scalar(rendered)) => {
            Ok(misfit_or_none(scalar_misfit(fit, rendered, accepted)?))
        }
        (KnownTypeUseRef::Scalar(accepted), _) => Ok(misfit_or_none(Some(format!(
            "its values are not provably within the param's {}",
            describe_scalar(accepted)
        )))),
        (KnownTypeUseRef::Ref(accepted), _) => ref_misfit(fit, rendered, accepted, seen),
    }
}

fn enum_misfit(rendered: &KnownTypeUseRef<'_>, accepted: &EnumTypeUse) -> Option<String> {
    let reason = format!(
        "its values are not provably values of the enum {}",
        quote_text(accepted.r#enum.as_str())
    );
    let KnownTypeUseRef::Enum(rendered) = rendered else {
        return Some(reason);
    };

    if rendered.r#enum != accepted.r#enum {
        return Some(reason);
    }

    let narrowing = accepted.narrowed_to.as_ref()?;
    let allowed: HashSet<&str> = narrowing.values.iter().map(String::as_str).collect();
    let within = rendered.narrowed_to.as_ref().is_some_and(|own| {
        own.values
            .iter()
            .all(|value| allowed.contains(value.as_str()))
    });

    if within { None } else { Some(reason) }
}

fn describe_scalar(scalar: &ScalarTypeUse) -> String {
    match &scalar.format {
        None => "refinements".to_owned(),
        Some(format) => format!("format {} and refinements", quote_text(format)),
    }
}

fn scalar_misfit(
    fit: &DeriveErrorsFit<'_>,
    rendered: &ScalarTypeUse,
    accepted: &ScalarTypeUse,
) -> Result<Option<String>, PassError> {
    if let Some(format) = &accepted.format
        && rendered.format.as_ref() != Some(format)
    {
        return Ok(Some(format!(
            "its format is not the param's format {}",
            quote_text(format)
        )));
    }

    if accepted.content.is_some() && rendered.content != accepted.content {
        return Ok(Some("its JSON content is not the param's".to_owned()));
    }

    refinements_misfit(fit, &rendered.refinements, &accepted.refinements)
}

// A decimal text checked by the example validator against one refinement: exact, whatever the
// bound's size.
fn decimal_keeps(
    fit: &DeriveErrorsFit<'_>,
    value: &str,
    refinements: &Refinements,
) -> Result<bool, PassError> {
    let decimal_use = TypeUse::Scalar(derive_errors_scalar_use(
        ScalarType::String,
        Some("decimal"),
        refinements.clone(),
    ));
    let issues = fit
        .examples
        .check_example(&JsonValue::String(value.to_owned()), &decimal_use)?;

    Ok(issues.is_empty())
}

/// A bound of the refinements, the four a decimal literal holds.
#[derive(Debug, Clone, Copy)]
enum Bound {
    Minimum,
    Maximum,
    ExclusiveMinimum,
    ExclusiveMaximum,
}

impl Bound {
    const fn name(self) -> &'static str {
        match self {
            Self::Minimum => "minimum",
            Self::Maximum => "maximum",
            Self::ExclusiveMinimum => "exclusiveMinimum",
            Self::ExclusiveMaximum => "exclusiveMaximum",
        }
    }

    const fn of(self, refinements: &Refinements) -> Option<&DecimalLiteral> {
        match self {
            Self::Minimum => refinements.minimum.as_ref(),
            Self::Maximum => refinements.maximum.as_ref(),
            Self::ExclusiveMinimum => refinements.exclusive_minimum.as_ref(),
            Self::ExclusiveMaximum => refinements.exclusive_maximum.as_ref(),
        }
    }

    /// Refinements holding this bound alone.
    fn only(self, limit: &DecimalLiteral) -> Refinements {
        let mut refinements = derive_errors_no_refinements();
        let slot = match self {
            Self::Minimum => &mut refinements.minimum,
            Self::Maximum => &mut refinements.maximum,
            Self::ExclusiveMinimum => &mut refinements.exclusive_minimum,
            Self::ExclusiveMaximum => &mut refinements.exclusive_maximum,
        };

        *slot = Some(limit.clone());

        refinements
    }
}

// For each bound of the param, the datum bounds that keep within it, each checked as
// `{ <key>: <param bound> }`.
const BOUND_KEEPERS: [(Bound, [(Bound, Bound); 2]); 4] = [
    (
        Bound::Minimum,
        [
            (Bound::Minimum, Bound::Minimum),
            (Bound::ExclusiveMinimum, Bound::Minimum),
        ],
    ),
    (
        Bound::ExclusiveMinimum,
        [
            (Bound::ExclusiveMinimum, Bound::Minimum),
            (Bound::Minimum, Bound::ExclusiveMinimum),
        ],
    ),
    (
        Bound::Maximum,
        [
            (Bound::Maximum, Bound::Maximum),
            (Bound::ExclusiveMaximum, Bound::Maximum),
        ],
    ),
    (
        Bound::ExclusiveMaximum,
        [
            (Bound::ExclusiveMaximum, Bound::Maximum),
            (Bound::Maximum, Bound::ExclusiveMaximum),
        ],
    ),
];

fn narrower(key: &str, accepted: &str) -> String {
    format!("its {key} is not provably within the param's {key} {accepted}")
}

fn bound_kept(
    fit: &DeriveErrorsFit<'_>,
    rendered: &Refinements,
    keepers: [(Bound, Bound); 2],
    limit: &DecimalLiteral,
) -> Result<bool, PassError> {
    for (own, checked_as) in keepers {
        let Some(value) = own.of(rendered) else {
            continue;
        };
        let checked = checked_as.only(limit);

        if decimal_keeps(fit, value.as_str(), &checked)? {
            return Ok(true);
        }
    }

    Ok(false)
}

fn refinements_misfit(
    fit: &DeriveErrorsFit<'_>,
    rendered: &Refinements,
    accepted: &Refinements,
) -> Result<Option<String>, PassError> {
    if let Some(minimum) = accepted.min_length
        && rendered.min_length.is_none_or(|own| own < minimum)
    {
        return Ok(Some(narrower("minLength", &minimum.to_string())));
    }

    if let Some(maximum) = accepted.max_length
        && rendered.max_length.is_none_or(|own| own > maximum)
    {
        return Ok(Some(narrower("maxLength", &maximum.to_string())));
    }

    if let Some(pattern) = &accepted.pattern
        && rendered.pattern.as_ref().map(|own| &own.normalized) != Some(&pattern.normalized)
    {
        return Ok(Some(format!(
            "its pattern is not the param's pattern {}",
            quote_text(&pattern.source)
        )));
    }

    for (bound, keepers) in &BOUND_KEEPERS {
        let Some(limit) = bound.of(accepted) else {
            continue;
        };

        if !bound_kept(fit, rendered, *keepers, limit)? {
            return Ok(Some(narrower(bound.name(), limit.as_str())));
        }
    }

    let Some(step) = &accepted.multiple_of else {
        return Ok(None);
    };
    let mut step_refinements = derive_errors_no_refinements();

    step_refinements.multiple_of = Some(step.clone());

    let kept = match &rendered.multiple_of {
        Some(own) => decimal_keeps(fit, own.as_str(), &step_refinements)?,
        None => false,
    };

    if kept {
        return Ok(None);
    }

    Ok(Some(narrower("multipleOf", step.as_str())))
}

fn array_misfit(
    fit: &DeriveErrorsFit<'_>,
    rendered: &ArrayTypeUse,
    accepted: &ArrayTypeUse,
    seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    if let Some(minimum) = accepted.min_items
        && rendered.min_items.is_none_or(|own| own < minimum)
    {
        return Ok(Some(derive_errors_misfit_reason(format!(
            "its minItems is not provably within the param's minItems {minimum}"
        ))));
    }

    if let Some(maximum) = accepted.max_items
        && rendered.max_items.is_none_or(|own| own > maximum)
    {
        return Ok(Some(derive_errors_misfit_reason(format!(
            "its maxItems is not provably within the param's maxItems {maximum}"
        ))));
    }

    let items = typed_misfit(
        fit,
        &DeriveErrorsTyped {
            use_: KnownTypeUseRef::try_from(&*rendered.items)?,
            nullable: false,
        },
        &DeriveErrorsTyped {
            use_: KnownTypeUseRef::try_from(&*accepted.items)?,
            nullable: false,
        },
        seen,
    )?;

    Ok(items.map(|reason| nested_reason("for an item, ", &reason)))
}

fn ref_misfit(
    fit: &DeriveErrorsFit<'_>,
    rendered: &KnownTypeUseRef<'_>,
    accepted: &RefTypeUse,
    seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    if let KnownTypeUseRef::Ref(own) = rendered
        && own.schema == accepted.schema
    {
        return Ok(None);
    }

    let target = derive_errors_object_of_use(fit.schemas, &KnownTypeUseRef::Ref(accepted))?;
    let source = derive_errors_object_of_use(fit.schemas, rendered)?;
    let (Some(target), Some(source)) = (target, source) else {
        return Ok(Some(derive_errors_misfit_reason(format!(
            "it is not provably of the param's schema {}",
            quote_text(accepted.schema.as_str())
        ))));
    };

    // A pair of schemas already under comparison fits unless another member says otherwise.
    let pair = format!("{} {}", source.id, target.id);

    if !seen.insert(pair) {
        return Ok(None);
    }

    let misfits = derive_errors_member_misfits(fit, source, target, &HashSet::new(), seen)?;

    if let Some(member) = misfits.into_iter().next() {
        return Ok(Some(nested_reason(
            &format!("for its member {}, ", quote_text(&member.member)),
            &member.reason,
        )));
    }

    let unwritten = target.properties.iter().find(|property| {
        !property.optional
            && !source
                .properties
                .iter()
                .any(|candidate| candidate.name == property.name)
    });

    Ok(unwritten.map(|property| {
        derive_errors_misfit_reason(format!(
            "it has no member {}, which the param requires",
            quote_text(&property.name)
        ))
    }))
}

/// The members of `source`, but `skipped` (written beside a merge), that may not validate against
/// `target`: one the target lacks, or one whose use does not fit.
pub(crate) fn derive_errors_member_misfits(
    fit: &DeriveErrorsFit<'_>,
    source: &ObjectSchema,
    target: &ObjectSchema,
    skipped: &HashSet<String>,
    seen: &mut HashSet<String>,
) -> Result<Vec<DeriveErrorsMemberMisfit>, PassError> {
    let mut misfits = Vec::new();

    for property in &source.properties {
        if skipped.contains(&property.name) {
            continue;
        }

        let Some(accepted) = target
            .properties
            .iter()
            .find(|candidate| candidate.name == property.name)
        else {
            misfits.push(DeriveErrorsMemberMisfit {
                member: property.name.clone(),
                lacking: true,
                reason: derive_errors_misfit_reason(format!(
                    "{} has no such member",
                    quote_text(target.id.as_str())
                )),
            });

            continue;
        };

        if let Some(reason) = member_misfit(fit, property, accepted, seen)? {
            misfits.push(DeriveErrorsMemberMisfit {
                member: property.name.clone(),
                lacking: false,
                reason,
            });
        }
    }

    Ok(misfits)
}

fn member_misfit(
    fit: &DeriveErrorsFit<'_>,
    property: &Property,
    accepted: &Property,
    seen: &mut HashSet<String>,
) -> Result<Option<DeriveErrorsMisfitReason>, PassError> {
    if property.optional && !accepted.optional {
        return Ok(Some(omittable_reason()));
    }

    typed_misfit(
        fit,
        &DeriveErrorsTyped {
            use_: KnownTypeUseRef::try_from(&property.r#type)?,
            nullable: property.nullable,
        },
        &DeriveErrorsTyped {
            use_: KnownTypeUseRef::try_from(&accepted.r#type)?,
            nullable: accepted.nullable,
        },
        seen,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds_of_scalar(scalar_type: ScalarType, nullable: bool) -> DeriveErrorsKinds {
        let scalar = TypeUse::Scalar(derive_errors_scalar_use(
            scalar_type,
            None,
            derive_errors_no_refinements(),
        ));
        let typed = DeriveErrorsTyped {
            use_: KnownTypeUseRef::try_from(&scalar).unwrap(),
            nullable,
        };

        derive_errors_kinds_of(&typed).unwrap()
    }

    fn only(kinds: &[DeriveErrorsJsonKind]) -> DeriveErrorsKinds {
        DeriveErrorsKinds::Only(kinds.iter().copied().collect())
    }

    #[test]
    fn a_number_takes_integers_and_a_nullable_use_takes_null() {
        assert_eq!(
            kinds_of_scalar(ScalarType::Number, true),
            only(&[
                DeriveErrorsJsonKind::Null,
                DeriveErrorsJsonKind::Integer,
                DeriveErrorsJsonKind::Number,
            ])
        );
        assert_eq!(
            kinds_of_scalar(ScalarType::Integer, false),
            only(&[DeriveErrorsJsonKind::Integer])
        );
    }

    #[test]
    fn kinds_fit_only_when_every_rendered_kind_is_accepted() {
        let integer = only(&[DeriveErrorsJsonKind::Integer]);
        let number = kinds_of_scalar(ScalarType::Number, false);

        assert!(derive_errors_kinds_fit(&integer, &number));
        assert!(!derive_errors_kinds_fit(&number, &integer));
        assert!(derive_errors_kinds_fit(&integer, &DeriveErrorsKinds::Any));
        assert!(!derive_errors_kinds_fit(&DeriveErrorsKinds::Any, &integer));
        assert!(derive_errors_kinds_fit(
            &DeriveErrorsKinds::Any,
            &DeriveErrorsKinds::Any
        ));
    }
}
