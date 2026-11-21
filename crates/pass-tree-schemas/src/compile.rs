//! The schema compiler of `tree.schemas`: every written schema becomes a type use; objects, maps and
//! unions are named schemas, an inline one hoisted under the name its position derives. A declared
//! scalar, array, enum use, opaque value or file is inlined at each use. Derived objects (`pick`,
//! `omit`) and `allOf` are merged into plain objects.

use indexmap::{IndexMap, IndexSet};
use std::collections::{HashMap, HashSet};
use std::mem;

use seampact_diagnostics::InternalError;
use seampact_ir::Name as IrName;
use seampact_ir::{
    ArrayTypeUse, BodyUnionTag, Direction, Docs, EnumId, EnumNarrowing, EnumTypeUse,
    ExtensionPlace, Extensions, FieldRestriction, FileTypeUse, HeaderUnionTag, InputPolicy,
    JsonContent, JsonMediaType, Layer, MapSchema, NameRole, ObjectSchema, OpaqueTypeUse, Property,
    Reason, RefTypeUse, RightId, ScalarType, Schema, SchemaId, TypeUse, UnionSchema, UnionTag,
    UnionVariant, UnknownKeys, UnknownKeysPolicy,
};
use seampact_ir::{KnownSchemaRef, KnownTypeUseRef, KnownUnionTagRef};
use seampact_js::{FiniteNumber, cmp_utf16};
use seampact_json::{JsonNumber, JsonObject, JsonValue, js_text_of};
use seampact_naming::{
    CanonicalIdOptions, Name, Role, canonical_id, derive_name, split_name, suffix_words,
};
use seampact_pipeline::{PassError, parse_size};

use crate::core::TreeSchemasReservation;
use crate::derived::{TreeSchemasDerivedHost, tree_schemas_derived_properties};
use crate::enums::{
    EnumChainMemo, EnumValues, tree_schemas_enum_values, tree_schemas_report_enum_without_values,
};
use crate::extensions::{
    TreeSchemasExtensionHolder, tree_schemas_extension_slot, tree_schemas_has_extensions,
};
use crate::raw::{
    TreeSchemasProblem, TreeSchemasRelated, TreeSchemasReporter, tree_schemas_entries,
    tree_schemas_is_object, tree_schemas_member, tree_schemas_pointer,
    tree_schemas_source_property,
};
use crate::rule::TreeSchemasRule;
use crate::scalars::{
    TreeSchemasScalars, tree_schemas_docs, tree_schemas_mapping_docs, written_count,
};
use crate::use_members::use_members;

/// Where a schema sits, which decides the marks it may carry and the unions it may be.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum TreeSchemasPlace {
    Declared,
    Property,
    Variant,
    Nested,
    RouteInput,
    QueryField,
    Position,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasPosition {
    pub(crate) pointer: String,
    /// The name an inline object, map or union here is hoisted under; `None` where no name is
    /// derived.
    pub(crate) name: Option<Name>,
    pub(crate) place: TreeSchemasPlace,
    /// The written name of a declared schema, which is its id.
    pub(crate) id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasCompiled {
    pub(crate) schema_use: TypeUse,
    /// A declared scalar marked sensitive: a property holding it is sensitive.
    pub(crate) sensitive: bool,
    /// A union whose tag is a request header, which only a route's whole input may be.
    pub(crate) header_union: bool,
}

/// The shape a written schema mapping has (ADR 0003 section 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Shape {
    Reference,
    Derived,
    Opaque,
    File,
    Enum,
    Union,
    AllOf,
    Object,
    Map,
    Array,
    Scalar,
}

impl Shape {
    /// How a message names the shape.
    fn text(self) -> &'static str {
        match self {
            Self::Reference => "a reference",
            Self::Derived => "a derived object",
            Self::Opaque => "an opaque value",
            Self::File => "a file",
            Self::Enum => "an enum use",
            Self::Union => "a union",
            Self::AllOf => "a merged object",
            Self::Object => "an object",
            Self::Map => "a map",
            Self::Array => "an array",
            Self::Scalar => "a scalar",
        }
    }

    /// The keywords the shape holds, besides the common ones.
    fn keywords(self) -> &'static [&'static str] {
        match self {
            Self::Reference => &["$ref", "unknownKeys"],
            Self::Derived => &[
                "pick",
                "omit",
                "required",
                "properties",
                "typeName",
                "unknownKeys",
            ],
            Self::Opaque => &["opaque"],
            Self::File => &["file"],
            Self::Enum => &["enum"],
            Self::Union => &["oneOf", "discriminator", "typeName", "unknownKeys"],
            Self::AllOf => &["allOf", "type", "typeName", "unknownKeys"],
            Self::Object => &["type", "properties", "required", "typeName", "unknownKeys"],
            Self::Map => &[
                "type",
                "additionalProperties",
                "propertyNames",
                "typeName",
                "unknownKeys",
            ],
            Self::Array => &["type", "items", "minItems", "maxItems"],
            Self::Scalar => &[
                "type",
                "format",
                "minLength",
                "maxLength",
                "pattern",
                "minimum",
                "maximum",
                "exclusiveMinimum",
                "exclusiveMaximum",
                "multipleOf",
                "contentMediaType",
                "contentSchema",
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NamedKind {
    Object,
    Map,
    Union,
}

impl NamedKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Object => "object",
            Self::Map => "map",
            Self::Union => "union",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct DeclaredTarget<'raw> {
    id: String,
    kind: Option<NamedKind>,
    value: Option<&'raw JsonValue>,
    /// An alias on the way to the target is nullable; the target's own `nullable` is read where it
    /// compiles.
    nullable: bool,
    /// The outermost declaration on the way that writes `unknownKeys`: every use naming it carries
    /// that policy.
    keys_from: Option<String>,
}

/// What a written value is: an entry of `examples`, a `default` or an extension value; each is
/// parsed like an example.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum TreeSchemasWrittenValue {
    Example,
    Default,
    Extension,
}

/// A value written in the run, an example or a default, parsed against its use once every schema
/// and enum is compiled.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasExampleCheck {
    /// The pointer of the written value.
    pub(crate) pointer: String,
    pub(crate) value: JsonValue,
    pub(crate) schema_use: TypeUse,
    pub(crate) written: TreeSchemasWrittenValue,
}

/// Annotations and marks any shape may hold; where each mark may sit is checked apart.
const COMMON_KEYWORDS: [&str; 10] = [
    "title",
    "description",
    "deprecated",
    "default",
    "examples",
    "nullable",
    "sensitive",
    "codeName",
    "restrictedTo",
    "lint",
];

/// A `default` fills an absent value: it sits on a property or an optional query field.
const DEFAULT_PLACES: [TreeSchemasPlace; 2] =
    [TreeSchemasPlace::Property, TreeSchemasPlace::QueryField];

/// The shapes written as a schema of their own, which holds their examples and docs.
const SCHEMA_WRITING_SHAPES: [Shape; 5] = [
    Shape::Object,
    Shape::Map,
    Shape::Union,
    Shape::AllOf,
    Shape::Derived,
];

/// The written annotations, each with where the author moves it when this position cannot keep it.
const ANNOTATION_FIX: [(&str, &str); 4] = [
    (
        "deprecated",
        "mark the property that holds this schema instead",
    ),
    (
        "examples",
        "put the example on the object that holds this value",
    ),
    (
        "title",
        "document the property or the schema that holds this one",
    ),
    (
        "description",
        "document the property or the schema that holds this one",
    ),
];

const SCALAR_TYPES: [&str; 4] = ["string", "integer", "number", "boolean"];
/// The prefix of a header source, `header.<name>`.
const HEADER_SOURCE_PREFIX: &str = "header.";
/// A written `null`, what a map without `additionalProperties` compiles.
static WRITTEN_NULL: JsonValue = JsonValue::Null;
const JSON_MEDIA: &str = "application/json";

#[derive(Debug, Clone, PartialEq)]
struct Claim {
    id: String,
    pointer: String,
    /// Set on a reserved id, whose pointer may be a core one that locates nothing.
    reservation: Option<TreeSchemasReservation>,
}

/// A declared schema with the keys it claims, since `claims` keeps only the first holder of a key.
#[derive(Debug, Clone, PartialEq)]
struct DeclaredClaim {
    claim: Claim,
    keys: Vec<String>,
}

/// What the compiler knows of a declared schema while it compiles.
#[derive(Debug, Clone, PartialEq)]
enum DeclaredEntry {
    Compiling,
    Refused,
    Compiled(Box<TreeSchemasCompiled>),
}

/// A union tag written in a body, checked against the properties of its variants.
#[derive(Debug, Clone, PartialEq)]
struct BodyTag {
    pointer: String,
    property: String,
    variants: Vec<UnionVariant>,
}

/// The body of a schema hoisted under a derived name: the members that are not the schema's meta.
#[derive(Debug, Clone, PartialEq)]
enum HoistedBody {
    Object {
        properties: Vec<Property>,
    },
    Map {
        keys: Option<Box<TypeUse>>,
        values: Box<TypeUse>,
    },
    Union {
        tag: UnionTag,
        variants: Vec<UnionVariant>,
    },
}

/// A union's tag and what the author named it.
#[derive(Debug, Clone, PartialEq)]
enum CodeNameOutcome {
    Written(IrName),
    Absent,
    Refused,
}

/// What a property's own type use is, once `nullable` moved out.
#[derive(Debug, Clone, PartialEq)]
struct NullableSplit {
    schema_use: TypeUse,
    nullable: bool,
}

/// The role a derived child name takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildRole {
    Property,
    Variant,
    Item,
    Value,
}

/// A property entry of a fields map, before it compiles.
#[derive(Debug, Clone, PartialEq)]
struct PropertyEntry<'raw> {
    wire: String,
    key: String,
    field: &'raw JsonValue,
    required: bool,
}

/// What a `allOf` or derived object reads its properties from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PropertyHolder {
    AllOf,
    Derived,
}

/// What makes up a name collision's fix.
const OPERATION_COLLISION_FIX: &str = "rename the schema or set operationId";

/// What the author renames when a derived name meets another.
fn collision_fix(role: Role) -> Option<&'static str> {
    match role {
        Role::Property => Some("rename the schema or the property"),
        Role::Variant => Some("rename the schema or the variant's tag"),
        Role::Item => Some("rename the schema or the array's owner"),
        Role::Value => Some("rename the schema or the map's owner"),
        Role::Params => Some("rename the schema, or the right, rule or error"),
        _ => None,
    }
}

fn has(value: &JsonObject, key: &str) -> bool {
    value.contains_key(key)
}

/// A compiled use that holds no mark: the form every inlined use takes.
fn plain_compiled(schema_use: TypeUse) -> TreeSchemasCompiled {
    TreeSchemasCompiled {
        schema_use,
        sensitive: false,
        header_union: false,
    }
}

/// A string member the authoring schema requires: validate refuses a contract without it before this
/// half runs.
fn guaranteed_string<'raw>(
    value: Option<&'raw JsonValue>,
    key: &str,
    pointer: &str,
) -> Result<&'raw str, PassError> {
    match value {
        Some(JsonValue::String(text)) => Ok(text),
        _ => Err(InternalError::new(format!(
            "tree.schemas found no string '{key}' at {pointer}, which validate guarantees"
        ))
        .into()),
    }
}

/// The shape a written schema mapping has, or `None` for none (ADR 0003 section 2).
pub(crate) fn tree_schemas_shape_of(value: &JsonObject) -> Option<Shape> {
    let written_type = match value.get("type") {
        Some(JsonValue::String(text)) => Some(text.as_str()),
        _ => None,
    };
    let shape = if has(value, "$ref") {
        Shape::Reference
    } else if has(value, "pick") || has(value, "omit") {
        Shape::Derived
    } else if has(value, "opaque") {
        Shape::Opaque
    } else if has(value, "file") {
        Shape::File
    } else if has(value, "enum") {
        Shape::Enum
    } else if has(value, "oneOf") {
        Shape::Union
    } else if has(value, "allOf") {
        Shape::AllOf
    } else if written_type == Some("object") {
        if has(value, "additionalProperties") {
            Shape::Map
        } else {
            Shape::Object
        }
    } else if written_type == Some("array") {
        Shape::Array
    } else if written_type.is_some_and(|text| SCALAR_TYPES.contains(&text)) || has(value, "format")
    {
        Shape::Scalar
    } else {
        return None;
    };

    Some(shape)
}

/// The words a child name starts with: the parent's segments, then its role's default suffix words,
/// so the child of a derived schema never meets the child of its declared namesake.
fn enum_type_use(name: &str, narrowed_to: Option<EnumNarrowing>) -> TypeUse {
    TypeUse::Enum(EnumTypeUse {
        r#enum: EnumId::new(name.to_owned()),
        narrowed_to,
        nullable: None,
        docs: None,
        examples: None,
    })
}

fn written_string_list(value: Option<&JsonValue>) -> Vec<String> {
    let Some(JsonValue::Array(items)) = value else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| match item {
            JsonValue::String(text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn words_of(name: Option<&Name>) -> Result<Option<Vec<String>>, PassError> {
    let Some(name) = name else {
        return Ok(None);
    };
    let suffixes = suffix_words(name, None)
        .map_err(|error| PassError::from(InternalError::new(error.to_string())))?;

    Ok(Some([name.segments.clone(), suffixes].concat()))
}

/// The keys a schema claims: its id, and the identifier it gives in every language as its words,
/// since two names with equal words collide whatever their spelling.
fn claim_keys(id: &str, name: &Name) -> Result<Vec<String>, PassError> {
    let suffixes = suffix_words(name, None)
        .map_err(|error| PassError::from(InternalError::new(error.to_string())))?;
    let words: Vec<&str> = name
        .segments
        .iter()
        .chain(&suffixes)
        .map(String::as_str)
        .collect();

    Ok(vec![
        format!("id {id}"),
        format!("words {}", words.join(" ")),
    ])
}

fn reserved_message(what: &str, id: &str, reservation: &TreeSchemasReservation) -> String {
    let purpose = &reservation.purpose;

    if id == reservation.id.as_str() {
        return format!("{what} '{id}' is reserved for {purpose}");
    }

    format!(
        "{what} '{id}' gives the same identifier as '{}', reserved for {purpose}",
        reservation.id.as_str()
    )
}

fn child_name(
    words: Option<&[String]>,
    own: &[String],
    role: ChildRole,
) -> Result<Option<Name>, PassError> {
    let Some(words) = words else {
        return Ok(None);
    };
    let needs_own_words = matches!(role, ChildRole::Property | ChildRole::Variant);

    if own.is_empty() && needs_own_words {
        return Ok(None);
    }

    let naming_role = match role {
        ChildRole::Property => Role::Property,
        ChildRole::Variant => Role::Variant,
        ChildRole::Item => Role::Item,
        ChildRole::Value => Role::Value,
    };

    derive_name(&[words, own].concat(), naming_role, None)
        .map(Some)
        .map_err(|error| PassError::from(InternalError::new(error.to_string())))
}

/// Whether two properties agree on everything but their origin and `optional`.
///
/// Compared as typed values, so a member order the TypeScript's `JSON.stringify` would tell apart
/// is not one here.
fn same_property(a: &Property, b: &Property) -> bool {
    let mut aligned = b.clone();

    aligned.origin = a.origin.clone();
    aligned.optional = a.optional;

    *a == aligned
}

/// The IR form of a name: `status` only on a response name.
pub(crate) fn ir_name(name: &Name) -> Result<IrName, PassError> {
    let role = NameRole::known(name.role.as_str()).ok_or_else(|| {
        InternalError::new(format!(
            "tree.schemas holds the name role {}, which the IR does not know",
            name.role.as_str()
        ))
    })?;

    Ok(IrName {
        segments: name.segments.clone(),
        role,
        status: name.status,
    })
}

fn without_nullable(schema_use: &TypeUse) -> Result<NullableSplit, PassError> {
    let mut copy = schema_use.clone();
    let members = use_members(&mut copy)?;

    if *members.nullable != Some(true) {
        return Ok(NullableSplit {
            schema_use: copy,
            nullable: false,
        });
    }

    *members.nullable = None;

    Ok(NullableSplit {
        schema_use: copy,
        nullable: true,
    })
}

/// A declared scalar marked sensitive: every use of it carries the mark, so a body, an item, a map
/// key or a header holding it stays sensitive; a property holds the mark itself.
fn mark_sensitive(compiled: &mut TreeSchemasCompiled) {
    compiled.sensitive = true;

    if let TypeUse::Scalar(scalar) = &mut compiled.schema_use {
        scalar.sensitive = Some(true);
    }
}

/// A property's own type use: `nullable` and `sensitive` move to the property.
fn own_type_use(schema_use: &TypeUse) -> Result<NullableSplit, PassError> {
    let TypeUse::Scalar(scalar) = schema_use else {
        return without_nullable(schema_use);
    };

    if scalar.sensitive != Some(true) {
        return without_nullable(schema_use);
    }

    let mut copy = scalar.clone();

    copy.sensitive = None;

    without_nullable(&TypeUse::Scalar(copy))
}

/// The depth-first walk over required, non-nullable object properties that finds a cycle.
#[derive(Debug, Default)]
struct RequiredCycleWalk {
    done: HashSet<String>,
    path: Vec<String>,
}

impl RequiredCycleWalk {
    fn visit(
        &mut self,
        id: &str,
        schemas: &IndexMap<String, Schema>,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<(), PassError> {
        if let Some(open) = self.path.iter().position(|entry| entry == id) {
            return Self::report_cycle(
                self.path.get(open..).unwrap_or_default(),
                id,
                schemas,
                reporter,
            );
        }

        if self.done.contains(id) {
            return Ok(());
        }

        self.path.push(id.to_owned());

        for target in required_object_targets(id, schemas)? {
            self.visit(&target, schemas, reporter)?;
        }

        self.path.pop();
        self.done.insert(id.to_owned());

        Ok(())
    }

    fn report_cycle(
        open_path: &[String],
        id: &str,
        schemas: &IndexMap<String, Schema>,
        reporter: &mut TreeSchemasReporter<'_, '_>,
    ) -> Result<(), PassError> {
        let Some(first) = schemas.get(id) else {
            return Ok(());
        };
        let cycle: Vec<&str> = open_path.iter().map(String::as_str).chain([id]).collect();

        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::SchemaCycle,
            pointer: schema_origin_pointer(first)?,
            message: format!(
                "the schemas {} hold each other through required, non-nullable properties, so no finite value fits",
                cycle.join(" -> ")
            ),
            fix: "make one of those properties optional or nullable".to_owned(),
            related: None,
        })
    }
}

// The object schemas an object schema holds through required, non-nullable properties.
fn required_object_targets(
    id: &str,
    schemas: &IndexMap<String, Schema>,
) -> Result<Vec<String>, PassError> {
    let Some(schema) = schemas.get(id) else {
        return Ok(Vec::new());
    };
    let KnownSchemaRef::Object(object) = KnownSchemaRef::try_from(schema)? else {
        return Ok(Vec::new());
    };
    let mut targets = Vec::new();

    for property in &object.properties {
        if property.optional || property.nullable {
            continue;
        }

        let KnownTypeUseRef::Ref(reference) = KnownTypeUseRef::try_from(&property.r#type)? else {
            continue;
        };
        let Some(target) = schemas.get(reference.schema.as_str()) else {
            continue;
        };

        if matches!(KnownSchemaRef::try_from(target)?, KnownSchemaRef::Object(_)) {
            targets.push(reference.schema.as_str().to_owned());
        }
    }

    Ok(targets)
}

fn schema_origin_pointer(schema: &Schema) -> Result<String, PassError> {
    Ok(schema.origin()?.pointer.clone())
}

/// A map key must be a string or an enum.
fn is_string_key(key_use: &TypeUse) -> Result<bool, PassError> {
    Ok(match KnownTypeUseRef::try_from(key_use)? {
        KnownTypeUseRef::Enum(_) => true,
        KnownTypeUseRef::Scalar(scalar) => scalar.r#type == ScalarType::String,
        KnownTypeUseRef::Ref(_)
        | KnownTypeUseRef::Opaque(_)
        | KnownTypeUseRef::File(_)
        | KnownTypeUseRef::Array(_) => false,
    })
}

/// A written number as JavaScript prints it in a message.
fn js_number_text(number: &JsonNumber) -> String {
    match FiniteNumber::new(number.to_f64()) {
        Some(finite) => finite.to_string(),
        None => number.to_string(),
    }
}

/// The schemas of one api, compiled once each, and the type use at each schema position compiled.
pub(crate) struct TreeSchemasCompiler<'raw, 'half, 'run> {
    /// Every named schema written so far, by id, children before their parent.
    pub(crate) schemas: IndexMap<String, Schema>,
    /// The type use at each schema position the half answers for.
    pub(crate) uses: IndexMap<String, TypeUse>,
    /// The pointer each schema this run wrote is written at: its declaration, or the position it is
    /// hoisted from.
    pub(crate) written_at: IndexMap<String, String>,
    /// The positions whose use a query wire is answered for, besides object properties: query
    /// fields, rule proofs.
    pub(crate) query_positions: IndexSet<String>,
    /// The body rule proofs among them: a JSON body holds a map, so a map there is no query wire
    /// but no fault.
    pub(crate) body_proof_positions: HashSet<String>,
    /// The direction of each position use; a declaration of `schemas` has none of its own.
    pub(crate) position_directions: IndexMap<String, Vec<Direction>>,
    /// Every written example, checked once the catalogues are complete.
    pub(crate) example_checks: Vec<TreeSchemasExampleCheck>,
    /// Every schema or property mapping that writes extension values, by pointer.
    pub(crate) extension_holders: IndexMap<String, TreeSchemasExtensionHolder<'raw>>,
    /// The pointer of every `unknownKeys` written on a use, checked against its directions.
    pub(crate) written_unknown_keys: Vec<String>,
    /// The pointers of the uses that carry a declaration's `unknownKeys`, by the pointer of that
    /// `unknownKeys`.
    pub(crate) unknown_keys_uses: IndexMap<String, Vec<String>>,
    pub(crate) scalars: TreeSchemasScalars<'raw>,
    pub(crate) reporter: TreeSchemasReporter<'half, 'run>,
    catalogue: Option<&'raw JsonValue>,
    enums: Option<&'raw JsonValue>,
    declared: IndexMap<String, DeclaredEntry>,
    /// The target each alias outside a cycle reaches, found once.
    declared_targets: HashMap<String, DeclaredTarget<'raw>>,
    /// The schema holding each id and each identifier (by its words): every declared schema, then
    /// each hoisted one. Both are checked: `AB` declared gives the words `ab`, the hoisted `A.b`
    /// gives `a b`, and both have the id `AB`.
    claims: IndexMap<String, Claim>,
    declared_claims: Vec<DeclaredClaim>,
    refused_reserved: HashSet<String>,
    body_tags: Vec<BodyTag>,
}

impl<'raw, 'half, 'run> TreeSchemasCompiler<'raw, 'half, 'run> {
    pub(crate) fn new(
        merged: &'raw JsonObject,
        reporter: TreeSchemasReporter<'half, 'run>,
    ) -> Result<Self, PassError> {
        let catalogue = merged.get("schemas");
        let mut declared_claims = Vec::new();
        let mut claims = IndexMap::new();

        for (id, _) in tree_schemas_entries(catalogue) {
            let claim = Claim {
                id: id.to_owned(),
                pointer: tree_schemas_pointer("/schemas", &[id]),
                reservation: None,
            };
            let name = Name {
                segments: split_name(id),
                role: Role::Schema,
                status: None,
            };
            let keys = claim_keys(id, &name)?;

            for key in &keys {
                claims.entry(key.clone()).or_insert_with(|| claim.clone());
            }

            declared_claims.push(DeclaredClaim { claim, keys });
        }

        Ok(Self {
            schemas: IndexMap::new(),
            uses: IndexMap::new(),
            written_at: IndexMap::new(),
            query_positions: IndexSet::new(),
            body_proof_positions: HashSet::new(),
            position_directions: IndexMap::new(),
            example_checks: Vec::new(),
            extension_holders: IndexMap::new(),
            written_unknown_keys: Vec::new(),
            unknown_keys_uses: IndexMap::new(),
            scalars: TreeSchemasScalars::new(merged.get("scalars")),
            reporter,
            catalogue,
            enums: merged.get("enums"),
            declared: IndexMap::new(),
            declared_targets: HashMap::new(),
            claims,
            declared_claims,
            refused_reserved: HashSet::new(),
            body_tags: Vec::new(),
        })
    }

    pub(crate) fn reserve(
        &mut self,
        reservations: &[TreeSchemasReservation],
    ) -> Result<(), PassError> {
        for reservation in reservations {
            let keys = claim_keys(reservation.id.as_str(), &reservation.name)?;

            self.seed_reservation(reservation);

            if reservation.yields {
                continue;
            }

            self.refuse_declared_matching(&keys, reservation)?;

            let claim = Claim {
                id: reservation.id.as_str().to_owned(),
                pointer: reservation.pointer.clone(),
                reservation: Some(reservation.clone()),
            };

            for key in keys {
                self.claims.insert(key, claim.clone());
            }
        }

        Ok(())
    }

    // Refuses every declared schema not yet compiled that holds a key of the reservation.
    fn refuse_declared_matching(
        &mut self,
        keys: &[String],
        reservation: &TreeSchemasReservation,
    ) -> Result<(), PassError> {
        for index in 0..self.declared_claims.len() {
            let Some(entry) = self.declared_claims.get(index) else {
                continue;
            };

            if self.declared.contains_key(&entry.claim.id) {
                continue;
            }

            if !entry.keys.iter().any(|key| keys.contains(key)) {
                continue;
            }

            let declared = entry.claim.clone();

            self.refuse_declared_reserved(&declared, reservation)?;
        }

        Ok(())
    }

    fn seed_reservation(&mut self, reservation: &TreeSchemasReservation) {
        if let Some(seed) = &reservation.seed {
            self.schemas.insert(
                reservation.id.as_str().to_owned(),
                Schema::Object(seed.clone()),
            );
        }
    }

    fn refuse_declared_reserved(
        &mut self,
        declared: &Claim,
        reservation: &TreeSchemasReservation,
    ) -> Result<(), PassError> {
        self.declared
            .insert(declared.id.clone(), DeclaredEntry::Refused);
        self.refused_reserved.insert(declared.id.clone());

        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::SchemaReserved,
            pointer: declared.pointer.clone(),
            message: reserved_message("the schema", &declared.id, reservation),
            fix: "declare the schema under another name".to_owned(),
            related: None,
        })
    }

    pub(crate) fn compile_catalogue(&mut self) -> Result<(), PassError> {
        let catalogue = self.catalogue;

        for (id, _) in tree_schemas_entries(catalogue) {
            if let Some(compiled) = self.compile_declared(id)? {
                self.uses
                    .insert(tree_schemas_pointer("/schemas", &[id]), compiled.schema_use);
            }
        }

        Ok(())
    }

    pub(crate) fn position(
        &mut self,
        value: &'raw JsonValue,
        position: &TreeSchemasPosition,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        let Some(compiled) = self.compile_at(value, position)? else {
            return Ok(());
        };

        if position.place != TreeSchemasPlace::QueryField {
            self.record_use(&position.pointer, compiled.schema_use, directions);

            return Ok(());
        }

        self.record_use(&position.pointer, compiled.schema_use.clone(), directions);
        self.written_default(Some(value), &position.pointer, &compiled.schema_use);

        Ok(())
    }

    pub(crate) fn share_use(&mut self, from: &str, pointer: &str, directions: &[Direction]) {
        let Some(schema_use) = self.uses.get(from) else {
            return;
        };
        let copy = schema_use.clone();

        self.record_use(pointer, copy, directions);
    }

    fn record_use(&mut self, pointer: &str, schema_use: TypeUse, directions: &[Direction]) {
        self.uses.insert(pointer.to_owned(), schema_use);
        self.position_directions
            .insert(pointer.to_owned(), directions.to_vec());
    }

    pub(crate) fn fields(
        &mut self,
        value: &'raw JsonValue,
        pointer: &str,
        name: &Name,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        let position = TreeSchemasPosition {
            pointer: pointer.to_owned(),
            name: Some(name.clone()),
            place: TreeSchemasPlace::Position,
            id: None,
        };

        if let JsonValue::String(written) = value {
            return self.fields_reference(written, &position, directions);
        }

        let entries: Vec<PropertyEntry<'raw>> = tree_schemas_entries(Some(value))
            .into_iter()
            .map(|(key, field)| {
                let wire = key.strip_suffix('?');

                PropertyEntry {
                    wire: wire.unwrap_or(key).to_owned(),
                    key: key.to_owned(),
                    field,
                    required: wire.is_none(),
                }
            })
            .collect();
        let words = words_of(Some(name))?;
        let Some(properties) = self.property_list(&entries, pointer, words.as_deref())? else {
            return Ok(());
        };

        if let Some(compiled) = self.object_schema(properties, None, &position)? {
            self.record_use(pointer, compiled.schema_use, directions);
        }

        Ok(())
    }

    // A fields position written as an object schema name: its properties are the fields.
    fn fields_reference(
        &mut self,
        written: &str,
        position: &TreeSchemasPosition,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        let Some(compiled) = self.reference(written, position)? else {
            return Ok(());
        };
        let names_object = match &compiled.schema_use {
            TypeUse::Ref(reference) => {
                self.kind_of(reference.schema.as_str())? == Some(NamedKind::Object)
            }
            _ => false,
        };

        if !names_object {
            return self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::FieldsSchema,
                pointer: position.pointer.clone(),
                message: format!(
                    "'{written}' is not an object schema, whose properties would be the fields"
                ),
                fix: "name an object schema, or write a fields map".to_owned(),
                related: None,
            });
        }

        self.record_use(&position.pointer, compiled.schema_use, directions);

        Ok(())
    }

    pub(crate) fn derived_object(
        &mut self,
        properties: Vec<Property>,
        pointer: &str,
        name: &Name,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        let position = TreeSchemasPosition {
            pointer: pointer.to_owned(),
            name: Some(name.clone()),
            place: TreeSchemasPlace::Position,
            id: None,
        };

        if let Some(compiled) = self.object_schema(properties, None, &position)? {
            self.record_use(pointer, compiled.schema_use, directions);
        }

        Ok(())
    }

    pub(crate) fn object_properties(
        &self,
        schema_use: Option<&TypeUse>,
    ) -> Result<Option<&[Property]>, PassError> {
        let Some(schema_use) = schema_use else {
            return Ok(None);
        };
        let KnownTypeUseRef::Ref(reference) = KnownTypeUseRef::try_from(schema_use)? else {
            return Ok(None);
        };
        let Some(schema) = self.schemas.get(reference.schema.as_str()) else {
            return Ok(None);
        };

        match KnownSchemaRef::try_from(schema)? {
            KnownSchemaRef::Object(object) => Ok(Some(&object.properties)),
            KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_) => Ok(None),
        }
    }

    pub(crate) fn finish(&mut self) -> Result<(), PassError> {
        self.check_body_tags()?;
        self.check_required_cycles()?;

        let catalogue = self.catalogue;
        let schema_ids: Vec<String> = tree_schemas_entries(catalogue)
            .into_iter()
            .map(|(id, _)| id.to_owned())
            .filter(|id| !self.refused_reserved.contains(id))
            .collect();

        self.check_names(&schema_ids, "/schemas", "schemas")?;

        let scalar_ids: Vec<String> = self
            .scalars
            .all(&mut self.reporter)?
            .iter()
            .map(|scalar| scalar.id.as_str().to_owned())
            .collect();

        self.check_names(&scalar_ids, "/scalars", "named formats")?;

        let enums = self.enums;
        let enum_ids: Vec<String> = tree_schemas_entries(enums)
            .into_iter()
            .map(|(id, _)| id.to_owned())
            .collect();

        self.check_names(&enum_ids, "/enums", "enums")
    }

    fn compile_at(
        &mut self,
        value: &'raw JsonValue,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        if let JsonValue::String(name) = value {
            return self.reference(name, position);
        }

        let shape = match value {
            JsonValue::Object(object) => tree_schemas_shape_of(object).map(|shape| (object, shape)),
            _ => None,
        };
        let Some((object, shape)) = shape else {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaShape,
                pointer: position.pointer.clone(),
                message: "the schema has no shape: no type, reference, enum, oneOf, allOf, opaque or file".to_owned(),
                fix: "write a 'type' (with 'properties' for an object), a schema name, or '{ opaque: <reason> }'".to_owned(),
                related: None,
            })?;

            return Ok(None);
        };

        if !self.check_keywords(object, shape, &position.pointer)?
            || !self.check_marks(object, shape, position)?
            || !self.check_annotations(object, shape, position)?
        {
            return Ok(None);
        }

        self.record_extension_holder(object, shape, position);

        let Some(mut compiled) = self.compile_shape(object, shape, position)? else {
            return Ok(None);
        };

        if matches!(object.get("nullable"), Some(JsonValue::Bool(true))) {
            *use_members(&mut compiled.schema_use)?.nullable = Some(true);
        }

        if matches!(object.get("sensitive"), Some(JsonValue::Bool(true)))
            && position.place == TreeSchemasPlace::Declared
        {
            mark_sensitive(&mut compiled);
        }

        if !self.apply_unknown_keys(value, &mut compiled.schema_use, &position.pointer)? {
            return Ok(None);
        }

        if position.place == TreeSchemasPlace::Nested && !SCHEMA_WRITING_SHAPES.contains(&shape) {
            self.annotate_use(object, &mut compiled.schema_use, &position.pointer)?;
        }

        Ok(Some(compiled))
    }

    // A use's own `unknownKeys` wins over the one of the schema it names.
    fn apply_unknown_keys(
        &mut self,
        value: &JsonValue,
        schema_use: &mut TypeUse,
        pointer: &str,
    ) -> Result<bool, PassError> {
        let Some(unknown_keys) = self.unknown_keys(Some(value), pointer)? else {
            return Ok(true);
        };

        // A map's keys are free: `unknownKeys` names an object, a union or a reference to one.
        if let TypeUse::Ref(reference) = schema_use
            && self.kind_of(reference.schema.as_str())? != Some(NamedKind::Map)
        {
            reference.unknown_keys = Some(unknown_keys);
            self.written_unknown_keys
                .push(tree_schemas_pointer(pointer, &["unknownKeys"]));

            return Ok(true);
        }

        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::UnknownKeys,
            pointer: tree_schemas_pointer(pointer, &["unknownKeys"]),
            message: "'unknownKeys' acts on the declared keys of an object or a union, and this schema is neither".to_owned(),
            fix: "remove 'unknownKeys' here, or set it on the object that holds this value".to_owned(),
            related: None,
        })?;

        Ok(false)
    }

    fn unknown_keys(
        &self,
        value: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<UnknownKeys>, PassError> {
        let Some(written) = tree_schemas_member(value, "unknownKeys") else {
            return Ok(None);
        };
        let at = tree_schemas_pointer(pointer, &["unknownKeys"]);
        let origin = Some(self.reporter.origin(&at)?);
        let unknown_keys = |policy: UnknownKeysPolicy, reason: Option<Reason>| UnknownKeys {
            policy,
            reason,
            origin: origin.clone(),
            derived_from: None,
        };

        if matches!(written, JsonValue::String(text) if text == "refuse") {
            return Ok(Some(unknown_keys(UnknownKeysPolicy::Refuse, None)));
        }

        for (key, policy) in [
            ("ignore", UnknownKeysPolicy::Ignore),
            ("keep", UnknownKeysPolicy::Keep),
        ] {
            if let Some(JsonValue::String(reason)) = tree_schemas_member(Some(written), key) {
                return Ok(Some(unknown_keys(
                    policy,
                    Some(Reason::new(reason.clone())),
                )));
            }
        }

        Err(InternalError::new(format!(
            "tree.schemas found no unknown keys policy at {at}, which validate guarantees"
        ))
        .into())
    }

    fn annotate_use(
        &mut self,
        value: &JsonObject,
        schema_use: &mut TypeUse,
        pointer: &str,
    ) -> Result<(), PassError> {
        let docs = tree_schemas_mapping_docs(value);
        let examples = self.written_examples(value.get("examples"), pointer, schema_use);
        let members = use_members(schema_use)?;

        if docs.summary.is_some() || docs.description.is_some() {
            *members.docs = Some(docs);
        }

        if examples.is_some() {
            *members.examples = examples;
        }

        Ok(())
    }

    fn written_examples(
        &mut self,
        value: Option<&JsonValue>,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Option<Vec<JsonValue>> {
        let Some(JsonValue::Array(examples)) = value else {
            return None;
        };

        for (index, example) in examples.iter().enumerate() {
            self.example_checks.push(TreeSchemasExampleCheck {
                pointer: tree_schemas_pointer(pointer, &["examples", &index.to_string()]),
                value: example.clone(),
                schema_use: schema_use.clone(),
                written: TreeSchemasWrittenValue::Example,
            });
        }

        Some(examples.clone())
    }

    fn written_default(
        &mut self,
        value: Option<&JsonValue>,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Option<JsonValue> {
        let written = tree_schemas_member(value, "default")?;

        self.example_checks.push(TreeSchemasExampleCheck {
            pointer: tree_schemas_pointer(pointer, &["default"]),
            value: written.clone(),
            schema_use: schema_use.clone(),
            written: TreeSchemasWrittenValue::Default,
        });

        Some(written.clone())
    }

    fn compile_shape(
        &mut self,
        value: &'raw JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let pointer = position.pointer.as_str();

        match shape {
            Shape::Reference => {
                let name = guaranteed_string(value.get("$ref"), "$ref", pointer)?;

                self.reference(name, position)
            }
            Shape::Derived => self.derived(value, position),
            Shape::Opaque => {
                let reason = guaranteed_string(value.get("opaque"), "opaque", pointer)?;

                Ok(Some(plain_compiled(TypeUse::Opaque(OpaqueTypeUse {
                    reason: Reason::new(reason.to_owned()),
                    origin: self.reporter.origin(pointer)?,
                    docs: None,
                    examples: None,
                    nullable: None,
                }))))
            }
            Shape::File => self.file(value.get("file"), pointer, &plain_compiled),
            Shape::Enum => self.enum_use(
                value.get("enum"),
                &tree_schemas_pointer(pointer, &["enum"]),
                &plain_compiled,
            ),
            Shape::Union => self.union(value, position),
            Shape::AllOf => self.all_of(value, position),
            Shape::Object => self.object(value, position),
            Shape::Map => self.map(value, position),
            Shape::Array => self.array(value, position, &plain_compiled),
            Shape::Scalar => self.scalar(value, position, &plain_compiled),
        }
    }

    fn check_keywords(
        &mut self,
        value: &JsonObject,
        shape: Shape,
        pointer: &str,
    ) -> Result<bool, PassError> {
        let allowed = shape.keywords();
        let mut misplaced: Vec<&str> = value
            .keys()
            .map(String::as_str)
            .filter(|key| {
                !key.starts_with("x-") && !COMMON_KEYWORDS.contains(key) && !allowed.contains(key)
            })
            .collect();

        if shape == Shape::AllOf
            && value.get("type").is_some_and(
                |written| !matches!(written, JsonValue::String(text) if text == "object"),
            )
        {
            misplaced.push("type");
        }

        for key in &misplaced {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaKeyword,
                pointer: tree_schemas_pointer(pointer, &[key]),
                message: format!("'{key}' has no meaning on {}", shape.text()),
                fix: format!("remove '{key}'"),
                related: None,
            })?;
        }

        Ok(misplaced.is_empty())
    }

    fn record_extension_holder(
        &mut self,
        value: &'raw JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) {
        if !tree_schemas_has_extensions(value) {
            return;
        }

        // A property's mapping extends the property; one that writes a named schema extends it, any
        // other nothing.
        let extended = if position.place == TreeSchemasPlace::Property {
            Some(ExtensionPlace::Property)
        } else if SCHEMA_WRITING_SHAPES.contains(&shape) {
            Some(ExtensionPlace::Schema)
        } else {
            None
        };

        self.extension_holders.insert(
            position.pointer.clone(),
            TreeSchemasExtensionHolder {
                pointer: position.pointer.clone(),
                value,
                place: extended,
            },
        );
    }

    fn check_marks(
        &mut self,
        value: &JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<bool, PassError> {
        let place = position.place;
        let named = matches!(
            shape,
            Shape::Object | Shape::Map | Shape::Union | Shape::AllOf
        );
        let mut refused: Vec<(&str, &str)> = Vec::new();

        for key in ["codeName", "restrictedTo"] {
            if has(value, key) && place != TreeSchemasPlace::Property {
                refused.push((key, "a property"));
            }
        }

        if has(value, "default") && !DEFAULT_PLACES.contains(&place) {
            refused.push(("default", "an optional property or an optional query field"));
        }

        if has(value, "sensitive")
            && place != TreeSchemasPlace::Property
            && !(place == TreeSchemasPlace::Declared && shape == Shape::Scalar)
        {
            refused.push(("sensitive", "a property or a declared scalar schema"));
        }

        if has(value, "typeName")
            && !(place == TreeSchemasPlace::Declared && (named || shape == Shape::Derived))
        {
            refused.push(("typeName", "a declared object, map or union schema"));
        }

        if shape == Shape::Opaque {
            for key in ["sensitive", "restrictedTo", "default"] {
                let marked = place == TreeSchemasPlace::Property
                    || (key == "default" && place == TreeSchemasPlace::QueryField);

                if has(value, key) && marked {
                    refused.push((
                        key,
                        "a checked value: an opaque value holds no mark or default",
                    ));
                }
            }
        }

        for (key, location) in &refused {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::MarkPosition,
                pointer: tree_schemas_pointer(&position.pointer, &[key]),
                message: format!("'{key}' sits on {location}"),
                fix: format!("remove '{key}' here"),
                related: None,
            })?;
        }

        Ok(refused.is_empty())
    }

    fn check_annotations(
        &mut self,
        value: &JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<bool, PassError> {
        let writes_schema = SCHEMA_WRITING_SHAPES.contains(&shape);
        let mut held: Vec<&str> = Vec::new();

        if position.place == TreeSchemasPlace::Property {
            held.extend(["deprecated", "title", "description", "examples"]);
        }

        if writes_schema {
            held.extend(["deprecated", "examples", "title", "description"]);
        }

        if position.place == TreeSchemasPlace::Nested {
            held.extend(["examples", "title", "description"]);
        }

        if position.place == TreeSchemasPlace::Variant {
            held.extend(["title", "description"]);
        }

        self.refuse_annotations(
            value,
            &format!("{} here", shape.text()),
            &position.pointer,
            &held,
        )
    }

    fn refuse_annotations(
        &mut self,
        value: &JsonObject,
        what: &str,
        pointer: &str,
        held: &[&str],
    ) -> Result<bool, PassError> {
        let refused: Vec<(&str, &str)> = ANNOTATION_FIX
            .iter()
            .copied()
            .filter(|(key, _)| has(value, key) && !held.contains(key))
            .collect();

        for (key, fix) in &refused {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::AnnotationPosition,
                pointer: tree_schemas_pointer(pointer, &[key]),
                message: format!("'{key}' on {what} is not kept by the contract model"),
                fix: format!("remove '{key}' here; {fix}"),
                related: None,
            })?;
        }

        Ok(refused.is_empty())
    }

    fn reference(
        &mut self,
        name: &str,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let Some(target) = self.declared_target(name)? else {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaUnknown,
                pointer: position.pointer.clone(),
                message: format!("no schema '{name}' is declared"),
                fix: "declare it under 'schemas', or fix the name".to_owned(),
                related: None,
            })?;

            return Ok(None);
        };

        // The refusal is already reported; a use would resolve to the core schema, not the author's.
        if self.refused_reserved.contains(&target.id) {
            return Ok(None);
        }

        let compiled = match target.kind {
            None => self.compile_declared(&target.id)?,
            Some(kind) => Some(TreeSchemasCompiled {
                schema_use: self.reference_use(&target.id, target.keys_from.as_deref())?,
                sensitive: false,
                header_union: kind == NamedKind::Union && Self::is_header_tagged(target.value),
            }),
        };
        let Some(mut compiled) = compiled else {
            return Ok(None);
        };

        if !self.check_header_union(compiled.header_union, position)? {
            return Ok(None);
        }

        if let Some(keys_from) = &target.keys_from {
            self.record_unknown_keys_use(keys_from, &position.pointer);
        }

        if target.nullable {
            *use_members(&mut compiled.schema_use)?.nullable = Some(true);
        }

        Ok(Some(compiled))
    }

    fn record_unknown_keys_use(&mut self, declaration: &str, pointer: &str) {
        let written = tree_schemas_pointer("/schemas", &[declaration, "unknownKeys"]);

        self.unknown_keys_uses
            .entry(written)
            .or_default()
            .push(pointer.to_owned());
    }

    /// A declared name followed through plain references, walked once with a list so a long chain
    /// cannot overflow the stack; each name outside a cycle is remembered.
    fn declared_target(&mut self, name: &str) -> Result<Option<DeclaredTarget<'raw>>, PassError> {
        let mut chain: Vec<(String, &'raw JsonValue)> = Vec::new();
        let mut index_on_chain: HashMap<String, usize> = HashMap::new();
        let mut current = name.to_owned();
        let mut cycle_start: Option<usize> = None;
        let end: Option<DeclaredTarget<'raw>>;

        loop {
            if let Some(remembered) = self.declared_targets.get(&current) {
                end = Some(remembered.clone());

                break;
            }

            let Some(value) = tree_schemas_member(self.catalogue, &current) else {
                end = self.seeded_core_target(&current)?;

                break;
            };
            let Some(alias) = Self::alias_of(value) else {
                end = Some(Self::plain_target(&current, value));

                break;
            };

            if let Some(seen_at) = index_on_chain.get(&current) {
                end = Some(Self::plain_target(&current, value));
                cycle_start = Some(*seen_at);

                break;
            }

            index_on_chain.insert(current.clone(), chain.len());
            chain.push((mem::replace(&mut current, alias.to_owned()), value));
        }

        let remembered_until = cycle_start.unwrap_or(chain.len());
        let mut target = end;

        for (index, (alias, value)) in chain.into_iter().enumerate().rev() {
            let resolved = Self::alias_target(&alias, value, target);

            if index < remembered_until {
                self.declared_targets.insert(alias, resolved.clone());
            }

            target = Some(resolved);
        }

        Ok(target)
    }

    /// The name a declaration only repeats: a bare string, or the `$ref` of an object.
    fn alias_of(value: &'raw JsonValue) -> Option<&'raw str> {
        match value {
            JsonValue::String(text) => Some(text.as_str()),
            _ => match tree_schemas_member(Some(value), "$ref") {
                Some(JsonValue::String(text)) => Some(text.as_str()),
                _ => None,
            },
        }
    }

    fn writes_unknown_keys(value: &JsonValue) -> bool {
        match value {
            JsonValue::Object(object) => has(object, "unknownKeys"),
            _ => false,
        }
    }

    /// An alias over the target it reaches; the alias alone when that target is not declared.
    fn alias_target(
        name: &str,
        value: &'raw JsonValue,
        target: Option<DeclaredTarget<'raw>>,
    ) -> DeclaredTarget<'raw> {
        let Some(target) = target else {
            return DeclaredTarget {
                id: name.to_owned(),
                kind: None,
                value: Some(value),
                nullable: false,
                keys_from: None,
            };
        };
        let nullable = target.nullable
            || matches!(
                tree_schemas_member(Some(value), "nullable"),
                Some(JsonValue::Bool(true))
            );
        let keys_from = if Self::writes_unknown_keys(value) {
            Some(name.to_owned())
        } else {
            target.keys_from
        };

        DeclaredTarget {
            nullable,
            keys_from,
            ..target
        }
    }

    fn plain_target(name: &str, value: &'raw JsonValue) -> DeclaredTarget<'raw> {
        let shape = match value {
            JsonValue::Object(object) => tree_schemas_shape_of(object),
            _ => None,
        };
        let kind = match shape {
            Some(Shape::Object | Shape::AllOf | Shape::Derived) => Some(NamedKind::Object),
            Some(Shape::Map) => Some(NamedKind::Map),
            Some(Shape::Union) => Some(NamedKind::Union),
            _ => None,
        };

        DeclaredTarget {
            id: name.to_owned(),
            kind,
            value: Some(value),
            nullable: false,
            keys_from: Self::writes_unknown_keys(value).then(|| name.to_owned()),
        }
    }

    fn seeded_core_target(&self, name: &str) -> Result<Option<DeclaredTarget<'raw>>, PassError> {
        let Some(schema) = self.schemas.get(name) else {
            return Ok(None);
        };

        if !matches!(schema.origin()?.layer, Layer::Core) {
            return Ok(None);
        }

        Ok(Some(DeclaredTarget {
            id: name.to_owned(),
            kind: Some(NamedKind::Object),
            value: None,
            nullable: false,
            keys_from: None,
        }))
    }

    fn compile_declared(&mut self, id: &str) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let pointer = tree_schemas_pointer("/schemas", &[id]);

        match self.declared.get(id) {
            Some(DeclaredEntry::Compiling) => {
                self.report_cycle(id, &pointer)?;
                self.declared.insert(id.to_owned(), DeclaredEntry::Refused);

                return Ok(None);
            }
            Some(DeclaredEntry::Refused) => return Ok(None),
            Some(DeclaredEntry::Compiled(compiled)) => return Ok(Some((**compiled).clone())),
            None => {}
        }

        self.declared
            .insert(id.to_owned(), DeclaredEntry::Compiling);

        let name = Name {
            segments: split_name(id),
            role: Role::Schema,
            status: None,
        };
        let compiled = match tree_schemas_member(self.catalogue, id) {
            Some(value) => self.compile_at(
                value,
                &TreeSchemasPosition {
                    pointer,
                    name: Some(name),
                    place: TreeSchemasPlace::Declared,
                    id: Some(id.to_owned()),
                },
            )?,
            None => None,
        };
        let entry = match &compiled {
            Some(compiled) => DeclaredEntry::Compiled(Box::new(compiled.clone())),
            None => DeclaredEntry::Refused,
        };

        self.declared.insert(id.to_owned(), entry);

        Ok(compiled)
    }

    fn report_cycle(&mut self, id: &str, pointer: &str) -> Result<(), PassError> {
        let derived = matches!(
            tree_schemas_member(self.catalogue, id),
            Some(JsonValue::Object(object)) if tree_schemas_shape_of(object) == Some(Shape::Derived)
        );

        let (message, fix) = if derived {
            (
                format!(
                    "the derived object '{id}' reaches itself through the sources of its 'pick' or 'omit' chain"
                ),
                "derive the chain from a schema that is not derived from it",
            )
        } else {
            (
                format!(
                    "the schema '{id}' reaches itself through schemas that are not objects, maps or unions"
                ),
                "break the cycle with a named object, or remove the self-reference",
            )
        };

        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::SchemaCycle,
            pointer: pointer.to_owned(),
            message,
            fix: fix.to_owned(),
            related: None,
        })
    }

    fn reference_use(&self, id: &str, keys_from: Option<&str>) -> Result<TypeUse, PassError> {
        let value = tree_schemas_member(self.catalogue, id);
        let nullable = matches!(
            tree_schemas_member(value, "nullable"),
            Some(JsonValue::Bool(true))
        );
        let unknown_keys = match keys_from {
            None => None,
            Some(declaration) => self.unknown_keys(
                tree_schemas_member(self.catalogue, declaration),
                &tree_schemas_pointer("/schemas", &[declaration]),
            )?,
        };

        Ok(TypeUse::Ref(RefTypeUse {
            schema: SchemaId::new(id.to_owned()),
            unknown_keys,
            nullable: nullable.then_some(true),
            docs: None,
            examples: None,
        }))
    }

    fn is_header_tagged(value: Option<&JsonValue>) -> bool {
        tree_schemas_is_object(tree_schemas_member(value, "discriminator"))
    }

    fn check_header_union(
        &mut self,
        header_union: bool,
        position: &TreeSchemasPosition,
    ) -> Result<bool, PassError> {
        let allowed = matches!(
            position.place,
            TreeSchemasPlace::RouteInput | TreeSchemasPlace::Declared
        );

        if !header_union || allowed {
            return Ok(true);
        }

        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::UnionHeader,
            pointer: position.pointer.clone(),
            message: "a union tagged by a request header is only allowed as a route's whole input"
                .to_owned(),
            fix: "tag the union by a body property, or use it as the route's 'input'".to_owned(),
            related: None,
        })?;

        Ok(false)
    }

    fn kind_of(&mut self, id: &str) -> Result<Option<NamedKind>, PassError> {
        if let Some(schema) = self.schemas.get(id) {
            let kind = match KnownSchemaRef::try_from(schema)? {
                KnownSchemaRef::Object(_) => NamedKind::Object,
                KnownSchemaRef::Map(_) => NamedKind::Map,
                KnownSchemaRef::Union(_) => NamedKind::Union,
            };

            return Ok(Some(kind));
        }

        Ok(self.declared_target(id)?.and_then(|target| target.kind))
    }

    fn id_of(position: &TreeSchemasPosition) -> Result<String, PassError> {
        if let Some(id) = &position.id {
            return Ok(id.clone());
        }

        let id = match &position.name {
            Some(name) => canonical_id(name, CanonicalIdOptions::default())
                .map_err(|error| PassError::from(InternalError::new(error.to_string())))?,
            None => None,
        };

        id.ok_or_else(|| {
            PassError::from(InternalError::new(format!(
                "tree.schemas derived no schema id at {}",
                position.pointer
            )))
        })
    }

    fn claimed(
        &mut self,
        position: &TreeSchemasPosition,
        kind: NamedKind,
    ) -> Result<bool, PassError> {
        let Some(name) = &position.name else {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaInline,
                pointer: position.pointer.clone(),
                message: format!("an inline {} has no derived name here", kind.as_str()),
                fix: "declare it under 'schemas' and write its name here".to_owned(),
                related: None,
            })?;

            return Ok(false);
        };
        let id = Self::id_of(position)?;

        if position.id.is_some() {
            return Ok(true);
        }

        self.claim_hoisted(&id, name, &position.pointer)
    }

    fn claim_hoisted(&mut self, id: &str, name: &Name, pointer: &str) -> Result<bool, PassError> {
        let keys = claim_keys(id, name)?;
        let other = keys
            .iter()
            .filter_map(|key| self.claims.get(key))
            .find(|claim| claim.pointer != pointer)
            .cloned();
        let fix = collision_fix(name.role).unwrap_or(OPERATION_COLLISION_FIX);

        let Some(other) = other else {
            for key in keys {
                self.claims.insert(
                    key,
                    Claim {
                        id: id.to_owned(),
                        pointer: pointer.to_owned(),
                        reservation: None,
                    },
                );
            }

            return Ok(true);
        };

        if let Some(reservation) = &other.reservation {
            let related = if reservation.seed.is_none() {
                vec![TreeSchemasRelated {
                    pointer: reservation.pointer.clone(),
                    message: format!(
                        "the params of '{}' take the id here",
                        reservation.id.as_str()
                    ),
                }]
            } else {
                Vec::new()
            };

            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaReserved,
                pointer: pointer.to_owned(),
                message: reserved_message("the name", id, reservation),
                fix: fix.to_owned(),
                related: Some(related),
            })?;

            return Ok(false);
        }

        let message = if other.id == id {
            format!("the name '{id}' this schema derives is already the name of another schema")
        } else {
            format!(
                "the name '{id}' this schema derives gives the same identifier as the schema '{}'",
                other.id
            )
        };

        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::NameCollision,
            pointer: pointer.to_owned(),
            message,
            fix: fix.to_owned(),
            related: Some(vec![TreeSchemasRelated {
                pointer: other.pointer.clone(),
                message: format!("'{}' is named here", other.id),
            }]),
        })?;

        Ok(false)
    }

    fn hoist(
        &mut self,
        body: HoistedBody,
        value: Option<&JsonObject>,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let kind = match &body {
            HoistedBody::Object { .. } => NamedKind::Object,
            HoistedBody::Map { .. } => NamedKind::Map,
            HoistedBody::Union { .. } => NamedKind::Union,
        };

        if !self.claimed(position, kind)? {
            return Ok(None);
        }

        let id = Self::id_of(position)?;
        let Some(name) = &position.name else {
            return Err(InternalError::new(format!(
                "tree.schemas hoists the schema at {} without a derived name",
                position.pointer
            ))
            .into());
        };
        let schema_name = ir_name(name)?;
        let written = |key: &str| value.and_then(|object| object.get(key));
        let type_name = match written("typeName") {
            Some(JsonValue::String(text)) => Some(text.clone()),
            _ => None,
        };
        let is_written_true = |key: &str| matches!(written(key), Some(JsonValue::Bool(true)));
        // A schema written `nullable` takes a null example (ADR 0003 section 1).
        let example_use = TypeUse::Ref(RefTypeUse {
            schema: SchemaId::new(id.clone()),
            unknown_keys: None,
            nullable: is_written_true("nullable").then_some(true),
            docs: None,
            examples: None,
        });
        let examples = self
            .written_examples(written("examples"), &position.pointer, &example_use)
            .unwrap_or_default();
        // A property's own `deprecated` marks the property (ADR 0003 section 1).
        let deprecated = (position.place != TreeSchemasPlace::Property
            && is_written_true("deprecated"))
        .then_some(true);
        let docs = value.map(tree_schemas_mapping_docs).unwrap_or_default();
        let extensions = match value {
            Some(object) if position.place != TreeSchemasPlace::Property => {
                tree_schemas_extension_slot(object)
            }
            _ => Extensions::new(),
        };
        let origin = self.reporter.origin(&position.pointer)?;
        let schema_id = SchemaId::new(id.clone());
        let header_union = matches!(
            &body,
            HoistedBody::Union { tag, .. }
                if matches!(KnownUnionTagRef::try_from(tag)?, KnownUnionTagRef::Header(_))
        );
        let schema = match body {
            HoistedBody::Object { properties } => Schema::Object(ObjectSchema {
                properties,
                id: schema_id,
                name: schema_name,
                type_name,
                directions: Vec::new(),
                examples,
                docs,
                extensions,
                origin,
                deprecated,
            }),
            HoistedBody::Map { keys, values } => Schema::Map(MapSchema {
                keys: keys.map(|keys| *keys),
                values: *values,
                id: schema_id,
                name: schema_name,
                type_name,
                directions: Vec::new(),
                examples,
                docs,
                extensions,
                origin,
                deprecated,
            }),
            HoistedBody::Union { tag, variants } => Schema::Union(UnionSchema {
                tag,
                variants,
                id: schema_id,
                name: schema_name,
                type_name,
                directions: Vec::new(),
                examples,
                docs,
                extensions,
                origin,
                deprecated,
            }),
        };

        self.written_at.insert(id.clone(), position.pointer.clone());
        self.schemas.insert(id.clone(), schema);

        Ok(Some(TreeSchemasCompiled {
            schema_use: self.reference_use(&id, None)?,
            sensitive: false,
            header_union,
        }))
    }

    fn object_schema(
        &mut self,
        properties: Vec<Property>,
        value: Option<&JsonObject>,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        if properties.is_empty() && position.place != TreeSchemasPlace::Variant {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::ObjectEmpty,
                pointer: position.pointer.clone(),
                message: "an object needs at least one property (only a union variant may hold its tag alone)".to_owned(),
                fix: "add a property, or write '{ opaque: <reason> }' for a free-form value".to_owned(),
                related: None,
            })?;

            return Ok(None);
        }

        self.hoist(HoistedBody::Object { properties }, value, position)
    }

    /// The host the derived-object merge reads through: the compiler itself.
    fn derived_host(&mut self) -> &mut dyn TreeSchemasDerivedHost {
        self
    }

    fn derived(
        &mut self,
        value: &JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let Some(properties) =
            tree_schemas_derived_properties(value, &position.pointer, self.derived_host())?
        else {
            return Ok(None);
        };

        self.object_schema(properties, Some(value), position)
    }

    fn object(
        &mut self,
        value: &'raw JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let words = words_of(position.name.as_ref())?;
        let Some(properties) = self.properties(value, &position.pointer, words.as_deref())? else {
            return Ok(None);
        };

        self.object_schema(properties, Some(value), position)
    }

    fn properties(
        &mut self,
        value: &'raw JsonObject,
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        let written: &[JsonValue] = match value.get("required") {
            Some(JsonValue::Array(names)) => names,
            _ => &[],
        };
        let required: IndexSet<&str> = written
            .iter()
            .filter_map(|name| match name {
                JsonValue::String(text) => Some(text.as_str()),
                _ => None,
            })
            .collect();
        let declared = tree_schemas_entries(value.get("properties"));
        let unknown: Vec<&str> = required
            .iter()
            .copied()
            .filter(|name| !declared.iter().any(|(key, _)| key == name))
            .collect();

        for name in &unknown {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::RequiredUnknown,
                pointer: tree_schemas_pointer(pointer, &["required"]),
                message: format!("'{name}' is required but is no property of the object"),
                fix: "declare the property, or remove it from 'required'".to_owned(),
                related: None,
            })?;
        }

        let entries: Vec<PropertyEntry<'raw>> = declared
            .into_iter()
            .map(|(key, field)| PropertyEntry {
                wire: key.to_owned(),
                key: key.to_owned(),
                field,
                required: required.contains(key),
            })
            .collect();
        let properties = self.property_list(
            &entries,
            &tree_schemas_pointer(pointer, &["properties"]),
            words,
        )?;

        if unknown.is_empty() {
            return Ok(properties);
        }

        Ok(None)
    }

    fn property_list(
        &mut self,
        entries: &[PropertyEntry<'raw>],
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        let mut properties = Vec::new();
        let mut identifiers: HashMap<String, String> = HashMap::new();
        let mut failed = false;

        for entry in entries {
            let at = tree_schemas_pointer(pointer, &[&entry.key]);
            let Some(property) =
                self.property(&entry.wire, entry.field, &at, words, entry.required)?
            else {
                failed = true;

                continue;
            };
            let segments = match &property.code_name {
                Some(code_name) => code_name.segments.clone(),
                None => split_name(&entry.wire),
            }
            .join(" ");

            if let Some(other) = identifiers.get(&segments) {
                failed = true;
                self.reporter.error(TreeSchemasProblem {
                    rule: TreeSchemasRule::NameCollision,
                    pointer: at,
                    message: format!(
                        "the properties '{}' and '{other}' give the same identifier",
                        entry.wire
                    ),
                    fix: "rename one, or set a 'codeName'".to_owned(),
                    related: Some(vec![TreeSchemasRelated {
                        pointer: tree_schemas_pointer(pointer, &[other]),
                        message: format!("'{other}' is here"),
                    }]),
                })?;
            }

            identifiers.insert(segments, entry.key.clone());
            properties.push(property);
        }

        if failed {
            return Ok(None);
        }

        Ok(Some(properties))
    }

    fn property(
        &mut self,
        wire: &str,
        field: &'raw JsonValue,
        pointer: &str,
        words: Option<&[String]>,
        required: bool,
    ) -> Result<Option<Property>, PassError> {
        let own = split_name(wire);
        let compiled = self.compile_at(
            field,
            &TreeSchemasPosition {
                pointer: pointer.to_owned(),
                name: child_name(words, &own, ChildRole::Property)?,
                place: TreeSchemasPlace::Property,
                id: None,
            },
        )?;
        let code_name = self.code_name(field, &own, wire, pointer)?;
        let restricted_to =
            self.restriction(tree_schemas_member(Some(field), "restrictedTo"), pointer)?;
        let default_value = tree_schemas_member(Some(field), "default");
        let mut refused_required = Vec::new();

        if required {
            if restricted_to.is_some() {
                refused_required.push("a restricted property is optional by nature");
            }

            if default_value.is_some() {
                refused_required.push("a default fills an absent property");
            }
        }

        for reason in &refused_required {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::RequiredProperty,
                pointer: pointer.to_owned(),
                message: format!("'{wire}' is listed in 'required', but {reason}"),
                fix: "remove it from 'required'".to_owned(),
                related: None,
            })?;
        }

        let (Some(compiled), false) = (
            compiled,
            code_name == CodeNameOutcome::Refused || !refused_required.is_empty(),
        ) else {
            return Ok(None);
        };

        let own_use = own_type_use(&compiled.schema_use)?;
        let field_shape = match field {
            JsonValue::Object(object) => tree_schemas_shape_of(object),
            _ => None,
        };
        let writes_schema = field_shape.is_some_and(|shape| SCHEMA_WRITING_SHAPES.contains(&shape));
        // An inline object, map or union keeps its examples on its hoisted schema.
        let examples = if writes_schema {
            None
        } else {
            self.written_examples(
                tree_schemas_member(Some(field), "examples"),
                pointer,
                &compiled.schema_use,
            )
        };
        let defaulted = self.written_default(Some(field), pointer, &compiled.schema_use);
        let marked = |key: &str| {
            matches!(
                tree_schemas_member(Some(field), key),
                Some(JsonValue::Bool(true))
            )
        };
        let extensions = match field {
            JsonValue::Object(object) => tree_schemas_extension_slot(object),
            _ => Extensions::new(),
        };

        Ok(Some(Property {
            name: wire.to_owned(),
            r#type: own_use.schema_use,
            optional: !required,
            nullable: own_use.nullable,
            sensitive: marked("sensitive") || compiled.sensitive,
            restricted_to,
            default: defaulted,
            deprecated: marked("deprecated"),
            code_name: match code_name {
                CodeNameOutcome::Written(written) => Some(written),
                CodeNameOutcome::Absent | CodeNameOutcome::Refused => None,
            },
            docs: tree_schemas_docs(Some(field)),
            extensions,
            origin: self.reporter.origin(pointer)?,
            derived_from: None,
            examples,
        }))
    }

    // ADR 0007 sections 1 and 2: a codeName replaces the segments of the wire name; a name with none needs one.
    fn code_name(
        &mut self,
        field: &JsonValue,
        own: &[String],
        wire: &str,
        pointer: &str,
    ) -> Result<CodeNameOutcome, PassError> {
        let written = match tree_schemas_member(Some(field), "codeName") {
            Some(JsonValue::String(text)) => Some(text.as_str()),
            _ => None,
        };
        let segments = match written {
            Some(text) => split_name(text),
            None => own.to_vec(),
        };

        if !segments.is_empty() {
            return Ok(match written {
                Some(_) => CodeNameOutcome::Written(IrName {
                    segments,
                    role: NameRole::Member,
                    status: None,
                }),
                None => CodeNameOutcome::Absent,
            });
        }

        let problem = match written {
            Some(text) => TreeSchemasProblem {
                rule: TreeSchemasRule::NameSegments,
                pointer: tree_schemas_pointer(pointer, &["codeName"]),
                message: format!("the codeName '{text}' yields no identifier segment"),
                fix: "write a codeName with letters or digits".to_owned(),
                related: None,
            },
            None => TreeSchemasProblem {
                rule: TreeSchemasRule::NameSegments,
                pointer: pointer.to_owned(),
                message: format!("the property '{wire}' yields no identifier segment"),
                fix: "set its 'codeName'".to_owned(),
                related: None,
            },
        };

        self.reporter.error(problem)?;

        Ok(CodeNameOutcome::Refused)
    }

    fn restriction(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<FieldRestriction>, PassError> {
        let Some(written) = written else {
            return Ok(None);
        };
        let origin = Some(
            self.reporter
                .origin(&tree_schemas_pointer(pointer, &["restrictedTo"]))?,
        );

        if let JsonValue::String(right) = written {
            return Ok(Some(FieldRestriction {
                right: RightId::new(right.clone()),
                params: None,
                input_policy: None,
                origin,
            }));
        }

        let right = guaranteed_string(
            tree_schemas_member(Some(written), "right"),
            "right",
            pointer,
        )?;
        let input_policy = match tree_schemas_member(Some(written), "input") {
            Some(JsonValue::String(text)) if text == "reject" => Some(InputPolicy::Reject),
            Some(JsonValue::String(text)) if text == "strip" => Some(InputPolicy::Strip),
            _ => None,
        };

        Ok(Some(FieldRestriction {
            right: RightId::new(right.to_owned()),
            params: tree_schemas_member(Some(written), "params").cloned(),
            input_policy,
            origin,
        }))
    }

    fn map(
        &mut self,
        value: &'raw JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let pointer = position.pointer.as_str();
        let words = words_of(position.name.as_ref())?;
        let values = self.compile_at(
            value.get("additionalProperties").unwrap_or(&WRITTEN_NULL),
            &TreeSchemasPosition {
                pointer: tree_schemas_pointer(pointer, &["additionalProperties"]),
                name: child_name(words.as_deref(), &[], ChildRole::Value)?,
                place: TreeSchemasPlace::Nested,
                id: None,
            },
        )?;
        let key_pointer = tree_schemas_pointer(pointer, &["propertyNames"]);
        let written_keys = value.get("propertyNames");
        let keys = match written_keys {
            None => None,
            Some(names) => self.compile_at(
                names,
                &TreeSchemasPosition {
                    pointer: key_pointer.clone(),
                    name: None,
                    place: TreeSchemasPlace::Nested,
                    id: None,
                },
            )?,
        };
        let key_use = keys.map(|compiled| compiled.schema_use);

        if let Some(key_use) = &key_use
            && !is_string_key(key_use)?
        {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::MapKeys,
                pointer: key_pointer,
                message: "the keys of a map are strings".to_owned(),
                fix: "write a string schema (with a format, a pattern or a length) or an enum"
                    .to_owned(),
                related: None,
            })?;

            return Ok(None);
        }

        let Some(values) = values else {
            return Ok(None);
        };

        if written_keys.is_some() && key_use.is_none() {
            return Ok(None);
        }

        self.hoist(
            HoistedBody::Map {
                keys: key_use.map(Box::new),
                values: Box::new(values.schema_use),
            },
            Some(value),
            position,
        )
    }

    fn array(
        &mut self,
        value: &'raw JsonObject,
        position: &TreeSchemasPosition,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let Some(written_items) = value.get("items") else {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaShape,
                pointer: position.pointer.clone(),
                message: "an array needs its item schema".to_owned(),
                fix: "add 'items'".to_owned(),
                related: None,
            })?;

            return Ok(None);
        };
        let words = words_of(position.name.as_ref())?;
        let items = self.compile_at(
            written_items,
            &TreeSchemasPosition {
                pointer: tree_schemas_pointer(&position.pointer, &["items"]),
                name: child_name(words.as_deref(), &[], ChildRole::Item)?,
                place: TreeSchemasPlace::Nested,
                id: None,
            },
        )?;
        let Some(items) = items else {
            return Ok(None);
        };
        let written_number = |key: &str| match value.get(key) {
            Some(JsonValue::Number(number)) => Some(number),
            _ => None,
        };
        let min_items = written_number("minItems");
        let max_items = written_number("maxItems");

        if let (Some(min), Some(max)) = (min_items, max_items)
            && min.to_f64() > max.to_f64()
        {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::RefinementRange,
                pointer: position.pointer.clone(),
                message: format!(
                    "no value fits the schema: 'minItems' {} is above 'maxItems' {}",
                    js_number_text(min),
                    js_number_text(max)
                ),
                fix: "lower the minimum or raise the maximum".to_owned(),
                related: None,
            })?;

            return Ok(None);
        }

        let count = |number: Option<&JsonNumber>, key: &str| match number {
            Some(written) => written_count(written, key, &position.pointer).map(Some),
            None => Ok(None),
        };

        Ok(Some(plain(TypeUse::Array(ArrayTypeUse {
            items: Box::new(items.schema_use),
            min_items: count(min_items, "minItems")?,
            max_items: count(max_items, "maxItems")?,
            nullable: None,
            docs: None,
            examples: None,
        }))))
    }

    fn scalar(
        &mut self,
        value: &'raw JsonObject,
        position: &TreeSchemasPosition,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let Some(mut scalar_use) =
            self.scalars
                .use_of(value, &position.pointer, &mut self.reporter)?
        else {
            return Ok(None);
        };
        let content_schema = value.get("contentSchema");

        if !has(value, "contentMediaType") && content_schema.is_none() {
            return Ok(Some(plain(TypeUse::Scalar(scalar_use))));
        }

        let json_media = matches!(
            value.get("contentMediaType"),
            Some(JsonValue::String(media)) if media == JSON_MEDIA
        );

        let (true, Some(content_schema), ScalarType::String) =
            (json_media, content_schema, &scalar_use.r#type)
        else {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaContent,
                pointer: position.pointer.clone(),
                message: "a JSON text field is a string with both 'contentMediaType: application/json' and 'contentSchema'".to_owned(),
                fix: "write 'type: string' with both keywords".to_owned(),
                related: None,
            })?;

            return Ok(None);
        };

        let content = self.compile_at(
            content_schema,
            &TreeSchemasPosition {
                pointer: tree_schemas_pointer(&position.pointer, &["contentSchema"]),
                name: None,
                place: TreeSchemasPlace::Nested,
                id: None,
            },
        )?;
        let Some(content) = content else {
            return Ok(None);
        };

        scalar_use.content = Some(JsonContent {
            media: JsonMediaType::ApplicationJson,
            schema: Box::new(content.schema_use),
        });

        Ok(Some(plain(TypeUse::Scalar(scalar_use))))
    }

    fn file(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let media = tree_schemas_member(written, "media");
        let max_size = tree_schemas_member(written, "maxSize");
        let max_size_bytes = match max_size {
            Some(JsonValue::String(text)) => parse_size(text)?,
            _ => None,
        };

        if max_size.is_some() && max_size_bytes.is_none() {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaShape,
                pointer: tree_schemas_pointer(pointer, &["file", "maxSize"]),
                message: format!(
                    "'{}' is no size this compiler can hold",
                    js_text_of(max_size)
                ),
                fix: "write a size such as 20MiB".to_owned(),
                related: None,
            })?;

            return Ok(None);
        }

        let max_size_bytes = max_size_bytes
            .map(|bytes| {
                i64::try_from(bytes).map_err(|_| {
                    PassError::from(InternalError::new(format!(
                        "tree.schemas found the size {bytes} at {pointer}, beyond a size the IR holds"
                    )))
                })
            })
            .transpose()?;
        let media_types = match media {
            Some(JsonValue::Array(types)) => types
                .iter()
                .filter_map(|media_type| match media_type {
                    JsonValue::String(text) => Some(text.clone()),
                    _ => None,
                })
                .collect(),
            _ => Vec::new(),
        };

        Ok(Some(plain(TypeUse::File(FileTypeUse {
            media: media_types,
            max_size_bytes,
            nullable: None,
            docs: None,
            examples: None,
        }))))
    }

    fn enum_use(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let name = match written {
            Some(JsonValue::String(name)) => name.as_str(),
            _ => guaranteed_string(tree_schemas_member(written, "narrow"), "narrow", pointer)?,
        };
        let found = tree_schemas_enum_values(self.enums, name, &mut EnumChainMemo::default());
        let values = match &found {
            Some(EnumValues::Values(values)) => values,
            Some(EnumValues::Cycle(_)) | None => {
                let at = if matches!(written, Some(JsonValue::String(_))) {
                    pointer.to_owned()
                } else {
                    tree_schemas_pointer(pointer, &["narrow"])
                };

                tree_schemas_report_enum_without_values(
                    &mut self.reporter,
                    name,
                    found.as_ref(),
                    &at,
                )?;

                return Ok(None);
            }
        };

        if matches!(written, Some(JsonValue::String(_))) {
            return Ok(Some(plain(enum_type_use(name, None))));
        }

        let subset = written_string_list(tree_schemas_member(written, "to"));
        let mut distinct: Vec<&String> = Vec::new();

        for value in &subset {
            if !distinct.contains(&value) {
                distinct.push(value);
            }
        }

        let strict = distinct.len() == subset.len()
            && subset.iter().all(|value| values.contains(value))
            && subset.len() < values.len();

        if !strict {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::EnumNarrowing,
                pointer: tree_schemas_pointer(pointer, &["to"]),
                message: format!(
                    "a narrowing of '{name}' lists some of its values, each once, and not all of them"
                ),
                fix: format!("keep a strict subset of [{}]", values.join(", ")),
                related: None,
            })?;

            return Ok(None);
        }

        let reason = match tree_schemas_member(written, "reason") {
            Some(JsonValue::String(text)) => Some(Reason::new(text.clone())),
            _ => None,
        };
        let narrowed: Vec<String> = values
            .iter()
            .filter(|value| subset.contains(value))
            .cloned()
            .collect();

        Ok(Some(plain(enum_type_use(
            name,
            Some(EnumNarrowing {
                values: narrowed,
                reason,
            }),
        ))))
    }

    fn union(
        &mut self,
        value: &'raw JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let pointer = position.pointer.as_str();
        let Some(tag) = self.union_tag(value.get("discriminator"), pointer)? else {
            return Ok(None);
        };
        let tag_in_header = matches!(
            KnownUnionTagRef::try_from(&tag)?,
            KnownUnionTagRef::Header(_)
        );

        if !self.check_header_union(tag_in_header, position)? {
            return Ok(None);
        }

        let words = words_of(position.name.as_ref())?;
        let mut variants: Vec<UnionVariant> = Vec::new();
        let mut failed = false;

        for (written, variant) in tree_schemas_entries(value.get("oneOf")) {
            let at = tree_schemas_pointer(pointer, &["oneOf", written]);
            let compiled = self.compile_at(
                variant,
                &TreeSchemasPosition {
                    pointer: at.clone(),
                    name: child_name(words.as_deref(), &split_name(written), ChildRole::Variant)?,
                    place: TreeSchemasPlace::Variant,
                    id: None,
                },
            )?;

            if let Some(compiled) = &compiled
                && let TypeUse::Ref(reference) = &compiled.schema_use
                && reference.nullable != Some(true)
                && self.kind_of(reference.schema.as_str())? == Some(NamedKind::Object)
            {
                variants.push(UnionVariant {
                    tag: written.to_owned(),
                    schema: reference.schema.clone(),
                    docs: Self::variant_docs(variant),
                });

                continue;
            }

            failed = true;

            let Some(compiled) = compiled else {
                continue;
            };
            let nullable = matches!(
                &compiled.schema_use,
                TypeUse::Ref(reference) if reference.nullable == Some(true)
            );
            let (message, fix) = if nullable {
                (
                    format!(
                        "the variant '{written}' is nullable, and a variant is an object that is never null"
                    ),
                    "name the object schema itself, without 'nullable'",
                )
            } else {
                (
                    format!("the variant '{written}' is not an object schema"),
                    "make the variant an object, or name an object schema",
                )
            };

            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::UnionVariant,
                pointer: at,
                message,
                fix: fix.to_owned(),
                related: None,
            })?;
        }

        if variants.is_empty() && !failed {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::UnionVariant,
                pointer: tree_schemas_pointer(pointer, &["oneOf"]),
                message: "a union needs at least one variant".to_owned(),
                fix: "map each tag value to its variant schema".to_owned(),
                related: None,
            })?;
        }

        if failed || variants.is_empty() {
            return Ok(None);
        }

        variants.sort_by(|a, b| cmp_utf16(&a.tag, &b.tag));

        if let KnownUnionTagRef::Body(body) = KnownUnionTagRef::try_from(&tag)? {
            self.body_tags.push(BodyTag {
                pointer: pointer.to_owned(),
                property: body.property.clone(),
                variants: variants.clone(),
            });
        }

        self.hoist(HoistedBody::Union { tag, variants }, Some(value), position)
    }

    // A variant naming a schema holds its own docs; an inline variant keeps them on its hoisted schema.
    fn variant_docs(variant: &JsonValue) -> Option<Docs> {
        let shape = match variant {
            JsonValue::Object(object) => tree_schemas_shape_of(object),
            _ => None,
        };

        if shape != Some(Shape::Reference) {
            return None;
        }

        let docs = tree_schemas_docs(Some(variant));

        if docs.summary.is_none() && docs.description.is_none() {
            return None;
        }

        Some(docs)
    }

    fn union_tag(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<UnionTag>, PassError> {
        if let Some(JsonValue::String(property)) = written {
            return Ok(Some(UnionTag::Body(BodyUnionTag {
                property: property.clone(),
            })));
        }

        let from = match tree_schemas_member(written, "from") {
            None | Some(JsonValue::Null) => String::new(),
            other => js_text_of(other),
        };

        if let Some(name) = tree_schemas_source_property(&from, HEADER_SOURCE_PREFIX) {
            return Ok(Some(UnionTag::Header(HeaderUnionTag {
                name: name.to_owned(),
            })));
        }

        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::UnionDiscriminator,
            pointer: pointer.to_owned(),
            message:
                "a union needs a discriminator: its tag property, or '{ from: header.<Name> }'"
                    .to_owned(),
            fix: "add 'discriminator: <tag property>'".to_owned(),
            related: None,
        })?;

        Ok(None)
    }

    fn all_of(
        &mut self,
        value: &'raw JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        let words = words_of(position.name.as_ref())?;

        let Some(merged) = self.merged_properties(value, &position.pointer, words.as_deref())?
        else {
            return Ok(None);
        };

        self.object_schema(merged, Some(value), position)
    }

    fn merged_properties(
        &mut self,
        value: &'raw JsonObject,
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        let mut merged: IndexMap<String, (Property, String)> = IndexMap::new();
        let mut failed = false;
        let members: &[JsonValue] = match value.get("allOf") {
            Some(JsonValue::Array(members)) => members,
            _ => &[],
        };

        for (index, member) in members.iter().enumerate() {
            let at = tree_schemas_pointer(pointer, &["allOf", &index.to_string()]);
            let Some(properties) = self.member_properties(member, &at, words)? else {
                failed = true;

                continue;
            };

            for property in properties {
                let Some((before, before_pointer)) = merged.get_mut(&property.name) else {
                    merged.insert(property.name.clone(), (property, at.clone()));

                    continue;
                };

                if same_property(before, &property) {
                    before.optional = before.optional && property.optional;

                    continue;
                }

                failed = true;
                self.reporter.error(TreeSchemasProblem {
                    rule: TreeSchemasRule::AllOfProperty,
                    pointer: at.clone(),
                    message: format!(
                        "the property '{}' is declared twice with different schemas",
                        property.name
                    ),
                    fix: "declare it once, or give both the same schema".to_owned(),
                    related: Some(vec![TreeSchemasRelated {
                        pointer: before_pointer.clone(),
                        message: "the other declaration is in this member".to_owned(),
                    }]),
                })?;
            }
        }

        if failed {
            return Ok(None);
        }

        Ok(Some(
            merged.into_values().map(|(property, _)| property).collect(),
        ))
    }

    fn member_properties(
        &mut self,
        member: &'raw JsonValue,
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        let written = match member {
            JsonValue::Object(object) => Some(object),
            _ => None,
        };

        // A member's own annotations have no place: the merged object holds the `allOf` schema's.
        if let Some(object) = written
            && !self.refuse_annotations(object, "a member of 'allOf'", pointer, &[])?
        {
            return Ok(None);
        }

        let name = match member {
            JsonValue::String(text) => Some(text),
            _ => match tree_schemas_member(Some(member), "$ref") {
                Some(JsonValue::String(text)) => Some(text),
                _ => None,
            },
        };

        if let Some(name) = name {
            return self.declared_properties(name, pointer, PropertyHolder::AllOf);
        }

        let Some(object) = written else {
            self.not_an_object_member(pointer)?;

            return Ok(None);
        };

        match tree_schemas_shape_of(object) {
            Some(shape @ Shape::Object) => {
                if self.check_keywords(object, shape, pointer)? {
                    self.properties(object, pointer, words)
                } else {
                    Ok(None)
                }
            }
            Some(Shape::AllOf) => self.merged_properties(object, pointer, words),
            Some(shape @ Shape::Derived) => {
                if self.check_keywords(object, shape, pointer)? {
                    tree_schemas_derived_properties(object, pointer, self.derived_host())
                } else {
                    Ok(None)
                }
            }
            Some(
                Shape::Reference
                | Shape::Opaque
                | Shape::File
                | Shape::Enum
                | Shape::Union
                | Shape::Map
                | Shape::Array
                | Shape::Scalar,
            )
            | None => {
                self.not_an_object_member(pointer)?;

                Ok(None)
            }
        }
    }

    fn declared_properties(
        &mut self,
        name: &str,
        pointer: &str,
        holder: PropertyHolder,
    ) -> Result<Option<Vec<Property>>, PassError> {
        let Some(target) = self.declared_target(name)? else {
            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::SchemaUnknown,
                pointer: pointer.to_owned(),
                message: format!("no schema '{name}' is declared"),
                fix: "declare it under 'schemas', or fix the name".to_owned(),
                related: None,
            })?;

            return Ok(None);
        };

        if target.kind != Some(NamedKind::Object) {
            return match holder {
                PropertyHolder::AllOf => {
                    self.not_an_object_member(pointer)?;

                    Ok(None)
                }
                PropertyHolder::Derived => {
                    self.not_a_derived_source(name, pointer)?;

                    Ok(None)
                }
            };
        }

        let is_core = match self.schemas.get(&target.id) {
            Some(schema) => matches!(schema.origin()?.layer, Layer::Core),
            None => false,
        };

        if !is_core && self.compile_declared(&target.id)?.is_none() {
            return Ok(None);
        }

        let Some(schema) = self.schemas.get(&target.id) else {
            return Ok(None);
        };

        Ok(match KnownSchemaRef::try_from(schema)? {
            KnownSchemaRef::Object(object) => Some(object.properties.clone()),
            KnownSchemaRef::Map(_) | KnownSchemaRef::Union(_) => None,
        })
    }

    fn not_a_derived_source(&mut self, name: &str, pointer: &str) -> Result<(), PassError> {
        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::DerivedSource,
            pointer: pointer.to_owned(),
            message: format!("the source '{name}' of a derived object is not an object schema"),
            fix: "derive from an object schema: a plain one, an 'allOf' or another derived object"
                .to_owned(),
            related: None,
        })
    }

    fn not_an_object_member(&mut self, pointer: &str) -> Result<(), PassError> {
        self.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::AllOfMember,
            pointer: pointer.to_owned(),
            message: "a member of 'allOf' is not an object schema".to_owned(),
            fix: "merge object schemas only".to_owned(),
            related: None,
        })
    }

    fn check_body_tags(&mut self) -> Result<(), PassError> {
        for tag in &self.body_tags {
            for variant in &tag.variants {
                let Some(schema) = self.schemas.get(variant.schema.as_str()) else {
                    continue;
                };
                let KnownSchemaRef::Object(object) = KnownSchemaRef::try_from(schema)? else {
                    continue;
                };

                if !object
                    .properties
                    .iter()
                    .any(|property| property.name == tag.property)
                {
                    continue;
                }

                self.reporter.error(TreeSchemasProblem {
                    rule: TreeSchemasRule::UnionTag,
                    pointer: tree_schemas_pointer(&tag.pointer, &["oneOf", &variant.tag]),
                    message: format!(
                        "the variant '{}' declares the tag property '{}'",
                        variant.tag, tag.property
                    ),
                    fix: "remove it from the variant; the union adds it".to_owned(),
                    related: None,
                })?;
            }
        }

        Ok(())
    }

    fn check_required_cycles(&mut self) -> Result<(), PassError> {
        let mut walk = RequiredCycleWalk::default();

        for id in self.schemas.keys() {
            walk.visit(id, &self.schemas, &mut self.reporter)?;
        }

        Ok(())
    }

    fn check_names(
        &mut self,
        ids: &[String],
        catalogue: &str,
        what: &str,
    ) -> Result<(), PassError> {
        let mut seen: HashMap<String, &str> = HashMap::new();

        for id in ids {
            let segments = split_name(id).join(" ");
            let Some(other) = seen.get(&segments) else {
                seen.insert(segments, id);

                continue;
            };

            self.reporter.error(TreeSchemasProblem {
                rule: TreeSchemasRule::NameCollision,
                pointer: tree_schemas_pointer(catalogue, &[id]),
                message: format!("the {what} '{id}' and '{other}' give the same identifier"),
                fix: "rename one of them".to_owned(),
                related: Some(vec![TreeSchemasRelated {
                    pointer: tree_schemas_pointer(catalogue, &[other]),
                    message: format!("'{other}' is declared here"),
                }]),
            })?;
        }

        Ok(())
    }
}

impl TreeSchemasDerivedHost for TreeSchemasCompiler<'_, '_, '_> {
    fn error(&mut self, problem: TreeSchemasProblem) -> Result<(), PassError> {
        self.reporter.error(problem)
    }

    fn source_properties(
        &mut self,
        name: &str,
        pointer: &str,
    ) -> Result<Option<Vec<Property>>, PassError> {
        self.declared_properties(name, pointer, PropertyHolder::Derived)
    }

    fn restriction(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<FieldRestriction, PassError> {
        let Some(restriction) = self.restriction(written, pointer)? else {
            return Err(PassError::from(InternalError::new(format!(
                "tree.schemas found no restrictedTo at {pointer}"
            ))));
        };

        Ok(restriction)
    }

    fn examples(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<Vec<JsonValue>>, PassError> {
        let written = tree_schemas_member(Some(value), "examples");

        Ok(self.written_examples(written, pointer, schema_use))
    }

    fn default_value(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<JsonValue>, PassError> {
        Ok(self.written_default(Some(value), pointer, schema_use))
    }
}
