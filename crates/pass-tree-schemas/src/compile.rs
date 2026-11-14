//! The schema compiler of `tree.schemas`: every written schema becomes a type use; objects, maps and
//! unions are named schemas, an inline one hoisted under the name its position derives. A declared
//! scalar, array, enum use, opaque value or file is inlined at each use. Derived objects (`pick`,
//! `omit`) and `allOf` are merged into plain objects.

use indexmap::{IndexMap, IndexSet};
use std::collections::HashSet;

use seampact_ir::Name as IrName;
use seampact_ir::{
    Direction, Docs, FieldRestriction, Property, Schema, TypeUse, UnionTag, UnionVariant,
    UnknownKeys,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_naming::{Name, Role};
use seampact_pipeline::PassError;

use crate::core::TreeSchemasReservation;
use crate::derived::TreeSchemasDerivedHost;
use crate::extensions::TreeSchemasExtensionHolder;
use crate::not_ported::not_ported_yet;
use crate::raw::{TreeSchemasProblem, TreeSchemasReporter};
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
    Err(not_ported_yet("claimKeys"))
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
        Err(not_ported_yet("TreeSchemasCompiler.constructor"))
    }

    pub(crate) fn reserve(
        &mut self,
        reservations: &[TreeSchemasReservation],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.reserve"))
    }

    fn seed_reservation(&mut self, reservation: &TreeSchemasReservation) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.seedReservation"))
    }

    fn refuse_declared_reserved(
        &mut self,
        declared: &Claim,
        reservation: &TreeSchemasReservation,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.refuseDeclaredReserved"))
    }

    pub(crate) fn compile_catalogue(&mut self) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.compileCatalogue"))
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
        Err(not_ported_yet("TreeSchemasCompiler.finish"))
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
        Err(not_ported_yet("TreeSchemasCompiler.checkBodyTags"))
    }

    fn check_required_cycles(&mut self) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.checkRequiredCycles"))
    }

    fn check_names(
        &mut self,
        ids: &[String],
        catalogue: &str,
        what: &str,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("TreeSchemasCompiler.checkNames"))
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
