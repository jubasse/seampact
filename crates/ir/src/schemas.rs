//! Named schemas, scalars and type uses.

use seampact_json::JsonValue;
use serde::{Deserialize, Serialize};

use crate::{
    DecimalLiteral, DerivedFrom, Direction, Docs, EnumId, Extensions, InputPolicy, JsonMediaType,
    Name, Origin, Reason, RightId, ScalarId, ScalarType, SchemaId, TypeUse, UnionTag,
    UnknownKeysPolicy, integers,
};

/// The `ObjectSchema` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSchema {
    /// The `properties` member.
    pub properties: Vec<Property>,

    /// The `id` member.
    pub id: SchemaId,

    /// The `name` member.
    pub name: Name,

    /// The `typeName` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,

    /// The `directions` member.
    pub directions: Vec<Direction>,

    /// The `examples` member.
    pub examples: Vec<JsonValue>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,

    /// The schema is deprecated (ADR 0003 section 1); absent means false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
}

/// The `MapSchema` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSchema {
    /// The `keys` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<TypeUse>,

    /// The `values` member.
    pub values: TypeUse,

    /// The `id` member.
    pub id: SchemaId,

    /// The `name` member.
    pub name: Name,

    /// The `typeName` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,

    /// The `directions` member.
    pub directions: Vec<Direction>,

    /// The `examples` member.
    pub examples: Vec<JsonValue>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,

    /// The schema is deprecated (ADR 0003 section 1); absent means false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
}

/// The `UnionSchema` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnionSchema {
    /// The `tag` member.
    pub tag: UnionTag,

    /// The `variants` member.
    pub variants: Vec<UnionVariant>,

    /// The `id` member.
    pub id: SchemaId,

    /// The `name` member.
    pub name: Name,

    /// The `typeName` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_name: Option<String>,

    /// The `directions` member.
    pub directions: Vec<Direction>,

    /// The `examples` member.
    pub examples: Vec<JsonValue>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,

    /// The schema is deprecated (ADR 0003 section 1); absent means false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<bool>,
}

/// The `BodyUnionTag` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyUnionTag {
    /// The `property` member.
    pub property: String,
}

/// The `HeaderUnionTag` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderUnionTag {
    /// The `name` member.
    pub name: String,
}

/// The `UnionVariant` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnionVariant {
    /// The `tag` member.
    pub tag: String,

    /// The `schema` member.
    pub schema: SchemaId,

    /// The docs written on the variant itself, beside its schema reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,
}

/// An object property; the wire name stays 'name' (ADR 0004 section 5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_excessive_bools,
    reason = "the schema's members; each boolean is its own member of the IR"
)]
pub struct Property {
    /// The `name` member.
    pub name: String,

    /// The `type` member.
    pub r#type: TypeUse,

    /// The `optional` member.
    pub optional: bool,

    /// The `nullable` member.
    pub nullable: bool,

    /// The `sensitive` member.
    pub sensitive: bool,

    /// The `restrictedTo` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restricted_to: Option<FieldRestriction>,

    /// The `default` member.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub default: Option<JsonValue>,

    /// The `deprecated` member.
    pub deprecated: bool,

    /// The `codeName` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_name: Option<Name>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `extensions` member.
    pub extensions: Extensions,

    /// The `origin` member.
    pub origin: Origin,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,

    /// The examples written on the property, each parsed against its type (ADR 0003 section 11).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,
}

/// A restrictedTo mark (ADR 0003 section 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldRestriction {
    /// The `right` member.
    pub right: RightId,

    /// The `params` member.
    #[serde(
        default,
        deserialize_with = "seampact_json::present",
        skip_serializing_if = "Option::is_none"
    )]
    pub params: Option<JsonValue>,

    /// The `inputPolicy` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_policy: Option<InputPolicy>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
}

/// Unknown keys of an input use (ADR 0003 section 4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnknownKeys {
    /// The `policy` member.
    pub policy: UnknownKeysPolicy,

    /// The `reason` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<Reason>,

    /// The `origin` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,

    /// The `derivedFrom` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_from: Option<DerivedFrom>,
}

/// The `RefTypeUse` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefTypeUse {
    /// The `schema` member.
    pub schema: SchemaId,

    /// The `unknownKeys` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unknown_keys: Option<UnknownKeys>,

    /// The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,

    /// The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,

    /// The examples written at the position of this use, placed as its docs are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,
}

/// Any JSON value, unchecked (ADR 0003 section 2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpaqueTypeUse {
    /// The `reason` member.
    pub reason: Reason,

    /// The `origin` member.
    pub origin: Origin,

    /// The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,

    /// The examples written at the position of this use, placed as its docs are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,

    /// The value may be JSON null (ADR 0003 section 2): an opaque value accepts null only with it; absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,
}

/// A multipart field or a download (A39).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTypeUse {
    /// The `media` member.
    pub media: Vec<String>,

    /// The `maxSizeBytes` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_size_bytes: Option<i64>,

    /// The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,

    /// The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,

    /// The examples written at the position of this use, placed as its docs are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,
}

/// The `EnumNarrowing` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumNarrowing {
    /// The `values` member.
    pub values: Vec<String>,

    /// The `reason` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<Reason>,
}

/// The `EnumTypeUse` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnumTypeUse {
    /// The `enum` member.
    pub r#enum: EnumId,

    /// The `narrowedTo` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub narrowed_to: Option<EnumNarrowing>,

    /// The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,

    /// The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,

    /// The examples written at the position of this use, placed as its docs are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,
}

/// A form or multipart text field holding JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonContent {
    /// The `media` member.
    pub media: JsonMediaType,

    /// The `schema` member.
    pub schema: Box<TypeUse>,
}

/// A scalar use. A use of a named format names it in 'scalar' and holds its type and refinements inline, so a target that does not map the named format still checks it (ADR 0003 section 8).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarTypeUse {
    /// The `type` member.
    pub r#type: ScalarType,

    /// A portable format of ADR 0003 section 8 ('uuid', 'int64', 'decimal'...); a named format is 'scalar'.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,

    /// The named format this use reads, from the scalars catalogue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scalar: Option<ScalarId>,

    /// The `refinements` member.
    pub refinements: Refinements,

    /// The `content` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<JsonContent>,

    /// The value is secret (ADR 0003 section 6): a use of a declared scalar marked sensitive; absent means false. A property's own type use leaves it out: Property.sensitive holds it (invariant ir.property.sensitive). A response carrying it is no-store (invariant ir.cache.sensitive-no-store).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sensitive: Option<bool>,

    /// The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,

    /// The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,

    /// The examples written at the position of this use, placed as its docs are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,
}

/// The `ArrayTypeUse` definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArrayTypeUse {
    /// The `items` member.
    pub items: Box<TypeUse>,

    /// The `minItems` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub min_items: Option<i64>,

    /// The `maxItems` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_items: Option<i64>,

    /// The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,

    /// The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<Docs>,

    /// The examples written at the position of this use, placed as its docs are.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<JsonValue>>,
}

/// A pattern refinement: the written text and its normalised form (ADR 0003 section 9).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    /// The `source` member.
    pub source: String,

    /// The `normalized` member.
    pub normalized: String,
}

/// The refinements of a scalar (ADR 0003 sections 1 and 8); numeric ones are decimal literal strings, compared numerically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Refinements {
    /// The `minLength` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub min_length: Option<i64>,

    /// The `maxLength` member.
    #[serde(
        default,
        deserialize_with = "integers::optional_count",
        skip_serializing_if = "Option::is_none"
    )]
    pub max_length: Option<i64>,

    /// The `pattern` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<Pattern>,

    /// The `minimum` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<DecimalLiteral>,

    /// The `maximum` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<DecimalLiteral>,

    /// The `exclusiveMinimum` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusive_minimum: Option<DecimalLiteral>,

    /// The `exclusiveMaximum` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusive_maximum: Option<DecimalLiteral>,

    /// The `multipleOf` member.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiple_of: Option<DecimalLiteral>,
}

/// A named format of the scalars catalogue: a base type plus refinements (ADR 0003 section 8). Its own type holds no 'scalar'.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scalar {
    /// The `id` member.
    pub id: ScalarId,

    /// The `name` member.
    pub name: Name,

    /// The `type` member.
    pub r#type: ScalarTypeUse,

    /// The `directions` member.
    pub directions: Vec<Direction>,

    /// The `docs` member.
    pub docs: Docs,

    /// The `origin` member.
    pub origin: Origin,
}
