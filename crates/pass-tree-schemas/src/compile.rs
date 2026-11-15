//! The schema compiler of `tree.schemas`: every written schema becomes a type use; objects, maps and
//! unions are named schemas, an inline one hoisted under the name its position derives. A declared
//! scalar, array, enum use, opaque value or file is inlined at each use. Derived objects (`pick`,
//! `omit`) and `allOf` are merged into plain objects.

use indexmap::{IndexMap, IndexSet};
use std::collections::{HashMap, HashSet};

use seampact_diagnostics::InternalError;
use seampact_ir::Name as IrName;
use seampact_ir::{
    Direction, Docs, FieldRestriction, Property, Schema, TypeUse, UnionTag, UnionVariant,
    UnknownKeys,
};
use seampact_ir::{KnownSchemaRef, KnownTypeUseRef};
use seampact_json::{JsonObject, JsonValue};
use seampact_naming::{Name, Role, split_name, suffix_words};
use seampact_pipeline::PassError;

use crate::core::TreeSchemasReservation;
use crate::derived::TreeSchemasDerivedHost;
use crate::extensions::TreeSchemasExtensionHolder;
use crate::not_ported::not_ported_yet;
use crate::raw::{
    TreeSchemasProblem, TreeSchemasRelated, TreeSchemasReporter, tree_schemas_entries,
    tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;
use crate::scalars::TreeSchemasScalars;

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

fn has(value: &JsonObject, key: &str) -> Result<bool, PassError> {
    Err(not_ported_yet("has"))
}

/// A string member the authoring schema requires: validate refuses a contract without it before this
/// half runs.
fn guaranteed_string(
    value: Option<&JsonValue>,
    key: &str,
    pointer: &str,
) -> Result<String, PassError> {
    Err(not_ported_yet("guaranteedString"))
}

/// The shape a written schema mapping has, or `None` for none (ADR 0003 section 2).
pub(crate) fn tree_schemas_shape_of(value: &JsonObject) -> Result<Option<Shape>, PassError> {
    Err(not_ported_yet("treeSchemasShapeOf"))
}

/// The words a child name starts with: the parent's segments, then its role's default suffix words,
/// so the child of a derived schema never meets the child of its declared namesake.
fn words_of(name: Option<&Name>) -> Result<Option<Vec<String>>, PassError> {
    Err(not_ported_yet("wordsOf"))
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

fn reserved_message(
    what: &str,
    id: &str,
    reservation: &TreeSchemasReservation,
) -> Result<String, PassError> {
    Err(not_ported_yet("reservedMessage"))
}

fn child_name(
    words: Option<&[String]>,
    own: &[String],
    role: ChildRole,
) -> Result<Option<Name>, PassError> {
    Err(not_ported_yet("childName"))
}

fn same_property(a: &Property, b: &Property) -> Result<bool, PassError> {
    Err(not_ported_yet("sameProperty"))
}

/// The IR form of a name: `status` only on a response name.
fn ir_name(name: &Name) -> Result<IrName, PassError> {
    Err(not_ported_yet("irName"))
}

fn without_nullable(schema_use: &TypeUse) -> Result<NullableSplit, PassError> {
    Err(not_ported_yet("withoutNullable"))
}

/// A declared scalar marked sensitive: every use of it carries the mark, so a body, an item, a map
/// key or a header holding it stays sensitive; a property holds the mark itself.
fn mark_sensitive(compiled: &mut TreeSchemasCompiled) -> Result<(), PassError> {
    Err(not_ported_yet("markSensitive"))
}

/// A property's own type use: `nullable` and `sensitive` move to the property.
fn own_type_use(schema_use: &TypeUse) -> Result<NullableSplit, PassError> {
    Err(not_ported_yet("ownTypeUse"))
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
        Err(not_ported_yet("TreeSchemasCompiler.refuseDeclaredReserved"))
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
        value: &JsonValue,
        position: &TreeSchemasPosition,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.position"))
    }

    pub(crate) fn share_use(
        &mut self,
        from: &str,
        pointer: &str,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.shareUse"))
    }

    fn record_use(
        &mut self,
        pointer: &str,
        schema_use: TypeUse,
        directions: &[Direction],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.recordUse"))
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
    ) -> Result<Option<Vec<Property>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.objectProperties"))
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
        value: &JsonValue,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.compileAt"))
    }

    fn apply_unknown_keys(
        &mut self,
        value: &JsonObject,
        schema_use: &mut TypeUse,
        pointer: &str,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.applyUnknownKeys"))
    }

    fn unknown_keys(
        &mut self,
        value: Option<&JsonValue>,
        pointer: &str,
    ) -> Result<Option<UnknownKeys>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.unknownKeys"))
    }

    fn annotate_use(
        &mut self,
        value: &JsonObject,
        schema_use: &mut TypeUse,
        pointer: &str,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.annotateUse"))
    }

    fn written_examples(
        &mut self,
        value: Option<&JsonValue>,
        pointer: &str,
        schema_use: &TypeUse,
    ) -> Result<Option<Vec<JsonValue>>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.writtenExamples"))
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
        value: &JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.compileShape"))
    }

    fn check_keywords(
        &mut self,
        value: &JsonObject,
        shape: Shape,
        pointer: &str,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.checkKeywords"))
    }

    fn record_extension_holder(
        &mut self,
        value: &'raw JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.recordExtensionHolder"))
    }

    fn check_marks(
        &mut self,
        value: &JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.checkMarks"))
    }

    fn check_annotations(
        &mut self,
        value: &JsonObject,
        shape: Shape,
        position: &TreeSchemasPosition,
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.checkAnnotations"))
    }

    fn refuse_annotations(
        &mut self,
        value: &JsonObject,
        what: &str,
        pointer: &str,
        held: &[&str],
    ) -> Result<bool, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.refuseAnnotations"))
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
        Err(not_ported_yet("TreeSchemasCompiler.compileDeclared"))
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
        Err(not_ported_yet("TreeSchemasCompiler.checkHeaderUnion"))
    }

    fn kind_of(&self, id: &str) -> Result<Option<NamedKind>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.kindOf"))
    }

    fn id_of(&self, position: &TreeSchemasPosition) -> Result<String, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.idOf"))
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
        Err(not_ported_yet("TreeSchemasCompiler.object"))
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
        value: &JsonObject,
        position: &TreeSchemasPosition,
        plain: &dyn Fn(TypeUse) -> TreeSchemasCompiled,
    ) -> Result<Option<TreeSchemasCompiled>, PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.scalar"))
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
        self.written_examples(Some(value), pointer, schema_use)
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
