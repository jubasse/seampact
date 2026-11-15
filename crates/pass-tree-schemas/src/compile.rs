//! The schema compiler of `tree.schemas`: every written schema becomes a type use; objects, maps and
//! unions are named schemas, an inline one hoisted under the name its position derives. A declared
//! scalar, array, enum use, opaque value or file is inlined at each use. Derived objects (`pick`,
//! `omit`) and `allOf` are merged into plain objects.

use indexmap::{IndexMap, IndexSet};
use std::collections::{HashMap, HashSet};

use seampact_diagnostics::InternalError;
use seampact_ir::Name as IrName;
use seampact_ir::{
    Direction, Docs, ExtensionPlace, FieldRestriction, JsonContent, JsonMediaType, NameRole,
    OpaqueTypeUse, Property, Reason, ScalarType, Schema, TypeUse, UnionTag, UnionVariant,
    UnknownKeys, UnknownKeysPolicy,
};
use seampact_ir::{KnownSchemaRef, KnownTypeUseRef};
use seampact_json::{JsonObject, JsonValue};
use seampact_naming::{
    CanonicalIdOptions, Name, Role, canonical_id, derive_name, split_name, suffix_words,
};
use seampact_pipeline::PassError;

use crate::core::TreeSchemasReservation;
use crate::derived::TreeSchemasDerivedHost;
use crate::extensions::{TreeSchemasExtensionHolder, tree_schemas_has_extensions};
use crate::not_ported::not_ported_yet;
use crate::raw::{
    TreeSchemasProblem, TreeSchemasRelated, TreeSchemasReporter, tree_schemas_entries,
    tree_schemas_member, tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;
use crate::scalars::{TreeSchemasScalars, tree_schemas_mapping_docs};
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
/// ECMAScript source of a header source, `header.<name>`.
const HEADER_SOURCE: &str = r"^header\.(.+)$";
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
fn collision_fix(role: &Role) -> Option<&'static str> {
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

fn same_property(a: &Property, b: &Property) -> Result<bool, PassError> {
    Err(not_ported_yet("sameProperty"))
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
fn mark_sensitive(compiled: &mut TreeSchemasCompiled) -> Result<(), PassError> {
    Err(not_ported_yet("markSensitive"))
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
    let pointer = match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => &object.origin.pointer,
        KnownSchemaRef::Map(map) => &map.origin.pointer,
        KnownSchemaRef::Union(union) => &union.origin.pointer,
    };

    Ok(pointer.clone())
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
        self.written_default(Some(value), &position.pointer, &compiled.schema_use)?;

        Ok(())
    }

    pub(crate) fn share_use(
        &mut self,
        from: &str,
        pointer: &str,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.shareUse"))
    }

    fn record_use(&mut self, pointer: &str, schema_use: TypeUse, directions: &[Direction]) {
        self.uses.insert(pointer.to_owned(), schema_use);
        self.position_directions
            .insert(pointer.to_owned(), directions.to_vec());
    }

    pub(crate) fn fields(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        name: &Name,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.fields"))
    }

    pub(crate) fn derived_object(
        &mut self,
        properties: Vec<Property>,
        pointer: &str,
        name: &Name,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.derivedObject"))
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
            mark_sensitive(&mut compiled)?;
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
        &mut self,
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
    ) -> Result<Option<JsonValue>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.writtenDefault"))
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
        Err(not_ported_yet("TreeSchemasCompiler.reference"))
    }

    fn record_unknown_keys_use(
        &mut self,
        declaration: &str,
        pointer: &str,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.recordUnknownKeysUse"))
    }

    fn declared_target(
        &mut self,
        name: &str,
        seen: &mut HashSet<String>,
    ) -> Result<Option<DeclaredTarget<'raw>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.declaredTarget"))
    }

    fn seeded_core_target(&self, name: &str) -> Result<Option<DeclaredTarget<'raw>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.seededCoreTarget"))
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
        Err(not_ported_yet("TreeSchemasCompiler.reportCycle"))
    }

    fn reference_use(&self, id: &str, keys_from: Option<&str>) -> Result<TypeUse, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.referenceUse"))
    }

    fn is_header_tagged(&self, value: Option<&JsonValue>) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.isHeaderTagged"))
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

    fn kind_of(&self, id: &str) -> Result<Option<NamedKind>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.kindOf"))
    }

    fn id_of(&self, position: &TreeSchemasPosition) -> Result<String, PassError> {
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
        Err(not_ported_yet("TreeSchemasCompiler.claimed"))
    }

    fn claim_hoisted(&mut self, id: &str, name: &Name, pointer: &str) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.claimHoisted"))
    }

    fn hoist(
        &mut self,
        body: HoistedBody,
        value: Option<&JsonObject>,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.hoist"))
    }

    fn object_schema(
        &mut self,
        properties: Vec<Property>,
        value: Option<&JsonObject>,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.objectSchema"))
    }

    /// The host the derived-object merge reads through: the compiler itself.
    fn derived_host(&mut self) -> Result<&mut dyn TreeSchemasDerivedHost, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.derivedHost"))
    }

    fn derived(
        &mut self,
        value: &JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.derived"))
    }

    fn object(
        &mut self,
        value: &JsonObject,
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
        value: &JsonObject,
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.properties"))
    }

    fn property_list(
        &mut self,
        entries: &[PropertyEntry<'_>],
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.propertyList"))
    }

    fn property(
        &mut self,
        wire: &str,
        field: &JsonValue,
        pointer: &str,
        words: Option<&[String]>,
        required: bool,
    ) -> Result<Option<Property>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.property"))
    }

    fn code_name(
        &mut self,
        field: &JsonValue,
        own: &[String],
        wire: &str,
        pointer: &str,
    ) -> Result<CodeNameOutcome, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.codeName"))
    }

    fn restriction(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<FieldRestriction>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.restriction"))
    }

    fn map(
        &mut self,
        value: &JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.map"))
    }

    fn array(
        &mut self,
        value: &JsonObject,
        position: &TreeSchemasPosition,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.array"))
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
        Err(not_ported_yet("TreeSchemasCompiler.file"))
    }

    fn enum_use(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.enumUse"))
    }

    fn union(
        &mut self,
        value: &JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.union"))
    }

    fn variant_docs(&self, variant: &JsonValue) -> Result<Option<Docs>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.variantDocs"))
    }

    fn union_tag(
        &mut self,
        written: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<UnionTag>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.unionTag"))
    }

    fn all_of(
        &mut self,
        value: &JsonObject,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.allOf"))
    }

    fn merged_properties(
        &mut self,
        value: &JsonObject,
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.mergedProperties"))
    }

    fn member_properties(
        &mut self,
        member: &JsonValue,
        pointer: &str,
        words: Option<&[String]>,
    ) -> Result<Option<Vec<Property>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.memberProperties"))
    }

    fn declared_properties(
        &mut self,
        name: &str,
        pointer: &str,
        holder: PropertyHolder,
    ) -> Result<Option<Vec<Property>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.declaredProperties"))
    }

    fn not_a_derived_source(&mut self, name: &str, pointer: &str) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.notADerivedSource"))
    }

    fn not_an_object_member(&mut self, pointer: &str) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.notAnObjectMember"))
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
        Err(not_ported_yet("TreeSchemasCompiler.derivedHost"))
    }

    fn examples(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<Vec<JsonValue>>, PassError> {
        Ok(self.written_examples(Some(value), pointer, schema_use))
    }

    fn default_value(
        &mut self,
        value: &JsonValue,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<JsonValue>, PassError> {
        self.written_default(Some(value), pointer, schema_use)
    }
}
