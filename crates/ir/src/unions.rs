//! Tagged unions: the `discriminator` and `oneOf` definitions, their tag dispatch and registry.

use seampact_json::{JsonError, JsonValue};
use serde::de::Error as _;
use serde::ser::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{
    ApplicationSignature, ArrayTemplate, ArrayTypeUse, BasicScheme, BearerScheme, BodyUnionTag,
    CatalogueEnumSource, CookieScheme, CredentialIdentity, DerivedCsrf, DerivedIdempotency,
    EachTemplate, EnumTypeUse, ExemptCsrf, ExemptIdempotency, FileTypeUse, HeaderScheme,
    HeaderUnionTag, IdentityAccess, IgnoreKeysPolicy, IgnoreUnknownQuery, KeepKeysPolicy,
    LabelApiVersion, LiteralTemplate, MapSchema, NoSubject, ObjectSchema, ObjectTemplate,
    OpaqueTypeUse, OptionalAccess, PathApiVersion, PlainMemberName, PlainTextPart, PublicAccess,
    QueryScheme, RefTypeUse, RefuseUnknownQuery, ResourceSubject, RightRequirement,
    RuleRequirement, ScalarTypeUse, SchemaPrincipal, ScopeSubject, SignatureScheme, SignedIdentity,
    SlotMemberName, SlotTemplate, SlotTextPart, SourceSchemeKey, TemplateSignature, TextTemplate,
    UnionSchema, ValueSchemeKey, VariantsPrincipal, VocabularyEnumSource,
};

/// A variant of a union that this IR revision does not know, kept as read.
///
/// Only decoding builds one, so a pass cannot make an unknown tag from text. It is written back
/// as the object it was read from.
#[derive(Debug, Clone, PartialEq)]
pub struct UnknownVariant {
    tag: String,
    raw: JsonValue,
}

impl UnknownVariant {
    /// The tag as read.
    #[must_use]
    pub fn tag(&self) -> &str {
        &self.tag
    }

    /// The whole object as read, its tag included.
    #[must_use]
    pub fn raw(&self) -> &JsonValue {
        &self.raw
    }

    fn read(tag: String, raw: serde_json::Value) -> Result<Self, JsonError> {
        Ok(Self {
            tag,
            raw: JsonValue::try_from(raw)?,
        })
    }
}

/// A union value narrowed to its closed form holds a variant this IR revision does not know.
///
/// A half narrows only values it built or read from the draft, so the failure is a bug of the
/// compiler, never a fault of the contract.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the {union} variant `{tag}` is not known to this compiler")]
pub struct NarrowUnionError {
    union: &'static str,
    tag: String,
}

impl NarrowUnionError {
    /// The union's definition name.
    #[must_use]
    pub const fn union(&self) -> &'static str {
        self.union
    }

    /// The tag of the unknown variant.
    #[must_use]
    pub fn tag(&self) -> &str {
        &self.tag
    }

    fn of(union: &'static str, variant: &UnknownVariant) -> Self {
        Self {
            union,
            tag: variant.tag().to_owned(),
        }
    }
}

/// One union of the IR schemas, as its registry entry lists it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnionEntry {
    /// The schema definition name, also the Rust type name.
    pub definition: &'static str,
    /// The member that holds the tag (`discriminator.propertyName`).
    pub tag_member: &'static str,
    /// The tag of each `oneOf` variant, in schema order.
    pub known_tags: &'static [&'static str],
    /// Whether the definition carries `x-seampact-must-act`.
    pub must_act: bool,
}

/// The tag member and known tags of the union named `definition`, or `None` for a name that is
/// no IR union.
#[must_use]
pub fn union_tags(definition: &str) -> Option<&'static UnionEntry> {
    UNIONS.iter().find(|entry| entry.definition == definition)
}

/// The tag of a union value: a missing or non-string tag is a decode error, as in the schema.
fn tag_of(value: &serde_json::Value, definition: &str, tag_member: &str) -> Result<String, String> {
    let serde_json::Value::Object(members) = value else {
        return Err(format!("expected a {definition} object"));
    };

    match members.get(tag_member) {
        Some(serde_json::Value::String(tag)) => Ok(tag.clone()),
        Some(_) => Err(format!(
            "the {definition} member `{tag_member}` is not a string"
        )),
        None => Err(format!("missing the {definition} member `{tag_member}`")),
    }
}

/// The unions TypeScript writes with `id` before the tag: the `schemes` and `identities`
/// declarations. A draft keeps the member order its writer gave, so the half oracle sees it.
const TAG_AFTER_ID_UNIONS: &[&str] = &["Scheme", "Identity"];

/// Where a union writes its tag member among the variant's members.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TagPlace {
    First,
    AfterId,
}

fn tag_place(definition: &str) -> TagPlace {
    if TAG_AFTER_ID_UNIONS.contains(&definition) {
        TagPlace::AfterId
    } else {
        TagPlace::First
    }
}

/// Writes a known variant: the tag member, then the variant's members, or the tag right after
/// `id` for the unions [`TAG_AFTER_ID_UNIONS`] names.
fn serialize_tagged<T: Serialize, S: Serializer>(
    tag_member: &str,
    tag: &str,
    place: TagPlace,
    variant: &T,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut value = serde_json::to_value(variant).map_err(S::Error::custom)?;

    let serde_json::Value::Object(members) = &mut value else {
        return Err(S::Error::custom(format!(
            "the `{tag}` variant does not serialize to an object"
        )));
    };

    let position = match place {
        TagPlace::First => 0,
        TagPlace::AfterId => members
            .keys()
            .position(|member| member == "id")
            .map_or(0, |id_position| id_position + 1),
    };

    members.shift_insert(
        position,
        tag_member.to_owned(),
        serde_json::Value::String(tag.to_owned()),
    );

    value.serialize(serializer)
}

/// Reads and writes `Scalar.type`, the one member that holds a variant struct, not its union:
/// with its tag, as the schema's `ScalarTypeUse` has it.
pub(crate) mod scalar_type_use_member {
    use serde::de::Error as _;
    use serde::{Deserialize, Deserializer, Serializer};

    use super::{TagPlace, serialize_tagged};
    use crate::{ScalarTypeUse, TypeUse};

    /// The tag member of a type use.
    const TAG_MEMBER: &str = "kind";

    /// The tag of a scalar type use.
    const SCALAR_TAG: &str = "scalar";

    pub(crate) fn serialize<S: Serializer>(
        type_use: &ScalarTypeUse,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serialize_tagged(
            TAG_MEMBER,
            SCALAR_TAG,
            TagPlace::First,
            type_use,
            serializer,
        )
    }

    pub(crate) fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<ScalarTypeUse, D::Error> {
        match TypeUse::deserialize(deserializer)? {
            TypeUse::Scalar(type_use) => Ok(type_use),
            other => Err(D::Error::custom(format!(
                "expected a type use of kind `{SCALAR_TAG}`, found `{}`",
                other.tag()
            ))),
        }
    }
}

/// Writes each union, its `tag`, serde by tag dispatch and the [`UNIONS`] registry; one
/// invocation lists every definition, so the registry cannot miss one.
///
/// Each union also gets its closed forms, the same variants without `Unknown`: an owned one
/// (`known`) that converts back into the union, and a borrowed one (`known_ref`) whose variants
/// borrow the union's, so narrowing a borrowed value clones nothing.
///
/// `Serialize` targets `serde_json` only, as [`JsonValue`]'s does.
macro_rules! ir_unions {
    ($(
        $(#[doc = $doc:literal])*
        $name:ident, known: $known:ident, known_ref: $known_ref:ident,
        tag: $tag_member:literal, must_act: $must_act:literal {
            $($variant:ident($variant_type:ty) = $tag:literal,)+
        }
    )+) => {
        $(
            $(#[doc = $doc])*
            #[derive(Debug, Clone, PartialEq)]
            #[allow(
                clippy::large_enum_variant,
                reason = "the variants hold the schema's structs by value, as the IR types design note fixes them"
            )]
            pub enum $name {
                $(
                    #[doc = concat!("The `", $tag, "` variant.")]
                    $variant($variant_type),
                )+
                /// A variant this IR revision does not know.
                Unknown(UnknownVariant),
            }

            impl $name {
                #[doc = concat!("The tag, the value of the `", $tag_member, "` member.")]
                #[must_use]
                pub fn tag(&self) -> &str {
                    match self {
                        $(Self::$variant(_) => $tag,)+
                        Self::Unknown(variant) => variant.tag(),
                    }
                }
            }

            impl Serialize for $name {
                fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                    match self {
                        $(Self::$variant(variant) => {
                            serialize_tagged($tag_member, $tag, tag_place(stringify!($name)), variant, serializer)
                        })+
                        Self::Unknown(variant) => variant.raw().serialize(serializer),
                    }
                }
            }

            impl<'de> Deserialize<'de> for $name {
                fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                    let value = serde_json::Value::deserialize(deserializer)?;
                    let tag = tag_of(&value, stringify!($name), $tag_member)
                        .map_err(D::Error::custom)?;

                    match tag.as_str() {
                        $($tag => serde_json::from_value(value)
                            .map(Self::$variant)
                            .map_err(|error| {
                                D::Error::custom(format!(
                                    "{} `{}`: {error}",
                                    stringify!($name),
                                    $tag
                                ))
                            }),)+
                        _ => UnknownVariant::read(tag, value)
                            .map(Self::Unknown)
                            .map_err(D::Error::custom),
                    }
                }
            }

            #[doc = concat!("The closed form of [`", stringify!($name), "`]: its known variants, owned.")]
            #[derive(Debug, Clone, PartialEq)]
            #[allow(
                clippy::large_enum_variant,
                reason = "the variants hold the schema's structs by value, as the open union does"
            )]
            pub enum $known {
                $(
                    #[doc = concat!("The `", $tag, "` variant.")]
                    $variant($variant_type),
                )+
            }

            #[doc = concat!("The closed form of a borrowed [`", stringify!($name), "`]: its known variants, borrowed.")]
            #[derive(Debug, Clone, Copy, PartialEq)]
            pub enum $known_ref<'union> {
                $(
                    #[doc = concat!("The `", $tag, "` variant.")]
                    $variant(&'union $variant_type),
                )+
            }

            impl From<$known> for $name {
                fn from(known: $known) -> Self {
                    match known {
                        $($known::$variant(variant) => Self::$variant(variant),)+
                    }
                }
            }

            impl TryFrom<$name> for $known {
                type Error = NarrowUnionError;

                fn try_from(open: $name) -> Result<Self, Self::Error> {
                    match open {
                        $($name::$variant(variant) => Ok(Self::$variant(variant)),)+
                        $name::Unknown(variant) => Err(NarrowUnionError::of(stringify!($name), &variant)),
                    }
                }
            }

            impl<'union> TryFrom<&'union $name> for $known_ref<'union> {
                type Error = NarrowUnionError;

                fn try_from(open: &'union $name) -> Result<Self, Self::Error> {
                    match open {
                        $($name::$variant(variant) => Ok(Self::$variant(variant)),)+
                        $name::Unknown(variant) => Err(NarrowUnionError::of(stringify!($name), variant)),
                    }
                }
            }

            // A copy of the borrowed variant, as the open union.
            impl From<$known_ref<'_>> for $name {
                fn from(known: $known_ref<'_>) -> Self {
                    match known {
                        $($known_ref::$variant(variant) => Self::$variant(variant.clone()),)+
                    }
                }
            }

            impl<'union> From<&'union $known> for $known_ref<'union> {
                fn from(known: &'union $known) -> Self {
                    match known {
                        $($known::$variant(variant) => Self::$variant(variant),)+
                    }
                }
            }
        )+

        /// Every union of the IR schemas, in schema file order.
        pub const UNIONS: &[UnionEntry] = &[
            $(UnionEntry {
                definition: stringify!($name),
                tag_member: $tag_member,
                known_tags: &[$($tag),+],
                must_act: $must_act,
            },)+
        ];
    };
}

ir_unions! {
    /// The key a signature is verified with: an id the application resolves to its secret, never the secret itself, written as a value or read from the request.
    SchemeKey, known: KnownSchemeKey, known_ref: KnownSchemeKeyRef,
    tag: "kind", must_act: true {
        Value(ValueSchemeKey) = "value",
        Source(SourceSchemeKey) = "from",
    }
    /// How a signature is verified (ADR 0004 section 4).
    SignatureVerify, known: KnownSignatureVerify, known_ref: KnownSignatureVerifyRef,
    tag: "verify", must_act: true {
        Template(TemplateSignature) = "template",
        Application(ApplicationSignature) = "application",
    }
    /// A security scheme (ADR 0004 section 4), tagged on its kind.
    Scheme, known: KnownScheme, known_ref: KnownSchemeRef,
    tag: "kind", must_act: true {
        Cookie(CookieScheme) = "cookie",
        Header(HeaderScheme) = "header",
        Query(QueryScheme) = "query",
        Bearer(BearerScheme) = "bearer",
        Basic(BasicScheme) = "basic",
        Signature(SignatureScheme) = "signature",
    }
    /// The principal schema: one schema, or one per credential variant.
    Principal, known: KnownPrincipal, known_ref: KnownPrincipalRef,
    tag: "kind", must_act: false {
        Schema(SchemaPrincipal) = "schema",
        Variants(VariantsPrincipal) = "variants",
    }
    /// Unknown keys of a signed identity's payload: ignored or kept, with the reason.
    KeysPolicy, known: KnownKeysPolicy, known_ref: KnownKeysPolicyRef,
    tag: "policy", must_act: true {
        Ignore(IgnoreKeysPolicy) = "ignore",
        Keep(KeepKeysPolicy) = "keep",
    }
    /// An identity (ADR 0004 section 4), tagged on its kind.
    Identity, known: KnownIdentity, known_ref: KnownIdentityRef,
    tag: "kind", must_act: true {
        Credential(CredentialIdentity) = "credential",
        Signed(SignedIdentity) = "signed",
    }
    /// The subject a right is checked against.
    RightSubject, known: KnownRightSubject, known_ref: KnownRightSubjectRef,
    tag: "kind", must_act: true {
        NoSubject(NoSubject) = "none",
        Scope(ScopeSubject) = "scope",
        Resource(ResourceSubject) = "resource",
    }
    /// Where an enum's values come from: a shared vocabulary or another enum.
    EnumSource, known: KnownEnumSource, known_ref: KnownEnumSourceRef,
    tag: "kind", must_act: false {
        Vocabulary(VocabularyEnumSource) = "vocabulary",
        Enum(CatalogueEnumSource) = "enum",
    }
    /// A template of the template language (ADR 0002 sections 13 and 14).
    Template, known: KnownTemplate, known_ref: KnownTemplateRef,
    tag: "kind", must_act: false {
        Slot(SlotTemplate) = "slot",
        Text(TextTemplate) = "text",
        Literal(LiteralTemplate) = "literal",
        Object(ObjectTemplate) = "object",
        Array(ArrayTemplate) = "array",
        Each(EachTemplate) = "each",
    }
    /// A part of a text template: literal text, or a slot with its path.
    TextPart, known: KnownTextPart, known_ref: KnownTextPartRef,
    tag: "kind", must_act: false {
        Text(PlainTextPart) = "text",
        Slot(SlotTextPart) = "slot",
    }
    /// The name of an object template member: literal text, or a slot.
    MemberName, known: KnownMemberName, known_ref: KnownMemberNameRef,
    tag: "kind", must_act: false {
        Text(PlainMemberName) = "text",
        Slot(SlotMemberName) = "slot",
    }
    /// The api version: the path version number, or a label when every surface's pathVersion is 'none'.
    ApiVersion, known: KnownApiVersion, known_ref: KnownApiVersionRef,
    tag: "kind", must_act: false {
        Path(PathApiVersion) = "path",
        Label(LabelApiVersion) = "label",
    }
    /// Undeclared query keys.
    UnknownQuery, known: KnownUnknownQuery, known_ref: KnownUnknownQueryRef,
    tag: "policy", must_act: true {
        Refuse(RefuseUnknownQuery) = "refuse",
        Ignore(IgnoreUnknownQuery) = "ignore",
    }
    /// Who may call the operation.
    Access, known: KnownAccess, known_ref: KnownAccessRef,
    tag: "kind", must_act: true {
        Identity(IdentityAccess) = "identity",
        Optional(OptionalAccess) = "optional",
        Public(PublicAccess) = "public",
    }
    /// A requirement, in declared order (FR-5).
    Requirement, known: KnownRequirement, known_ref: KnownRequirementRef,
    tag: "kind", must_act: true {
        Right(RightRequirement) = "right",
        Rule(RuleRequirement) = "rule",
    }
    /// The idempotency key of an unsafe operation: derived settings, or an exemption with its reason.
    Idempotency, known: KnownIdempotency, known_ref: KnownIdempotencyRef,
    tag: "kind", must_act: true {
        Derived(DerivedIdempotency) = "derived",
        Exempt(ExemptIdempotency) = "exempt",
    }
    /// The CSRF check of an unsafe operation reached through a cookie scheme: the derived header, or an exemption with its reason (invariant ir.csrf.cookie).
    Csrf, known: KnownCsrf, known_ref: KnownCsrfRef,
    tag: "kind", must_act: true {
        Derived(DerivedCsrf) = "derived",
        Exempt(ExemptCsrf) = "exempt",
    }
    /// A named schema: objects, maps and unions are always named (ADR 0004 section 5).
    Schema, known: KnownSchema, known_ref: KnownSchemaRef,
    tag: "kind", must_act: false {
        Object(ObjectSchema) = "object",
        Map(MapSchema) = "map",
        Union(UnionSchema) = "union",
    }
    /// Where a union's tag is read; 'header' only for a route's whole input.
    UnionTag, known: KnownUnionTag, known_ref: KnownUnionTagRef,
    tag: "in", must_act: false {
        Body(BodyUnionTag) = "body",
        Header(HeaderUnionTag) = "header",
    }
    /// What a property, item, body or parameter is (ADR 0004 section 5).
    TypeUse, known: KnownTypeUse, known_ref: KnownTypeUseRef,
    tag: "kind", must_act: false {
        Ref(RefTypeUse) = "ref",
        Opaque(OpaqueTypeUse) = "opaque",
        File(FileTypeUse) = "file",
        Enum(EnumTypeUse) = "enum",
        Scalar(ScalarTypeUse) = "scalar",
        Array(ArrayTypeUse) = "array",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_tag_decodes_its_variant_and_writes_the_tag_back() {
        let text = r#"{"kind":"value","value":"secret"}"#;
        let key: SchemeKey = serde_json::from_str(text).unwrap();

        assert!(matches!(&key, SchemeKey::Value(variant) if variant.value == "secret"));
        assert_eq!(key.tag(), "value");
        assert_eq!(serde_json::to_string(&key).unwrap(), text);
    }

    #[test]
    fn a_scheme_writes_its_tag_after_its_id_as_typescript_does() {
        let text = r#"{"id":"bearer","kind":"bearer","origin":{"layer":"api","pointer":"/schemes/bearer"}}"#;
        let scheme: Scheme = serde_json::from_str(text).unwrap();

        assert_eq!(serde_json::to_string(&scheme).unwrap(), text);
    }

    #[test]
    fn an_error_inside_a_known_variant_names_the_union_and_the_tag() {
        let error = serde_json::from_str::<SchemeKey>(r#"{"kind":"value","value":5}"#)
            .unwrap_err()
            .to_string();

        assert!(
            error.starts_with("SchemeKey `value`: "),
            "the error is {error:?}"
        );
    }

    #[test]
    fn an_unknown_tag_is_kept_and_written_back_as_read() {
        let text = r#"{"kind":"tuple","items":[1.5,"x"]}"#;
        let type_use: TypeUse = serde_json::from_str(text).unwrap();

        assert_eq!(type_use.tag(), "tuple");
        assert!(matches!(type_use, TypeUse::Unknown(_)));
        assert_eq!(serde_json::to_string(&type_use).unwrap(), text);
    }

    #[test]
    fn a_missing_or_non_string_tag_is_a_decode_error() {
        let missing = serde_json::from_str::<TypeUse>(r#"{"schema":"Point"}"#).unwrap_err();
        let number = serde_json::from_str::<TypeUse>(r#"{"kind":1}"#).unwrap_err();

        assert!(
            missing
                .to_string()
                .contains("missing the TypeUse member `kind`")
        );
        assert!(number.to_string().contains("`kind` is not a string"));
    }

    #[test]
    fn union_tags_names_the_tag_member_and_known_tags() {
        let csrf = union_tags("Csrf").unwrap();

        assert_eq!(csrf.tag_member, "kind");
        assert_eq!(csrf.known_tags, ["derived", "exempt"]);
        assert!(csrf.must_act);
        assert_eq!(union_tags("Origin"), None);
    }

    fn signature_verify_of(text: &str) -> SignatureVerify {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn a_known_variant_narrows_owned_and_borrowed_and_converts_back() {
        let open = signature_verify_of(r#"{"verify":"application","headers":[]}"#);
        let borrowed = KnownSignatureVerifyRef::try_from(&open).unwrap();

        assert!(matches!(borrowed, KnownSignatureVerifyRef::Application(_)));

        let known = KnownSignatureVerify::try_from(open.clone()).unwrap();

        assert_eq!(
            KnownSignatureVerifyRef::from(&known),
            KnownSignatureVerifyRef::try_from(&open).unwrap()
        );
        assert_eq!(SignatureVerify::from(known), open);
    }

    #[test]
    fn a_borrowed_narrowing_borrows_the_variant_it_was_given() {
        let open = signature_verify_of(r#"{"verify":"application","headers":[]}"#);
        let (SignatureVerify::Application(variant), KnownSignatureVerifyRef::Application(narrowed)) =
            (&open, KnownSignatureVerifyRef::try_from(&open).unwrap())
        else {
            panic!("the application variant expected, got {open:?}");
        };

        assert!(std::ptr::eq(variant, narrowed));
    }

    #[test]
    fn an_unknown_variant_does_not_narrow_and_names_the_union_and_tag() {
        let open = signature_verify_of(r#"{"verify":"hardware","slot":2}"#);
        let borrowed = KnownSignatureVerifyRef::try_from(&open).unwrap_err();
        let owned = KnownSignatureVerify::try_from(open).unwrap_err();

        assert_eq!(borrowed, owned);
        assert_eq!(owned.union(), "SignatureVerify");
        assert_eq!(owned.tag(), "hardware");
        assert_eq!(
            owned.to_string(),
            "the SignatureVerify variant `hardware` is not known to this compiler"
        );
    }

    #[test]
    fn a_borrowed_known_variant_copies_back_into_the_open_union() {
        let open = signature_verify_of(r#"{"verify":"application","headers":[]}"#);
        let narrowed = KnownSignatureVerifyRef::try_from(&open).unwrap();

        assert_eq!(SignatureVerify::from(narrowed), open);
    }
}
