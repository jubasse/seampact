//! Relay-copied declarations: the schemas, enums and named formats a relay route's copied shape uses
//! join this api, each keeping its origin in the public api with `api` naming it. The public api is a
//! workspace api that ran (`relayed`) or an import. The copied uses also give this api's declarations
//! their directions: a parameter or the body input is read, a success response written. Nothing about
//! access is copied, so a rule's proof schema is not.

use std::collections::HashSet;

use indexmap::IndexMap;
use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    Direction, Enum, EnumId, ExtensionKeyDecl, ExtensionKeyId, ImportedIr, IrClosedCheck,
    IrClosedDeclaration, IrClosedUnknown, IrMap, KnownEnumSourceRef, KnownSchemaRef,
    KnownTypeUseRef, Operation, Origin, Params, Response, Scalar, ScalarId, Schema, SchemaId,
    TypeUse, check_ir_closed_declaration,
};
use seampact_json::{JsonObject, JsonValue, canonical_json};
use seampact_pass_tree_shared::{RelayTarget, relay_target, tree_nodes_relay_origin};
use seampact_pipeline::{
    DraftIr, DraftOperation, DraftOperationInputRef, HalfContext, PassError, TreeNodeKind,
    TreeNodes,
};

use crate::compile::TreeSchemasCompiler;
use crate::operations::encoded;
use crate::raw::{
    TreeSchemasProblem, TreeSchemasRelated, TreeSchemasReporter, tree_schemas_pointer,
};
use crate::rule::TreeSchemasRule;

/// A use of a relay route's copied shape, in the direction its position is read or written.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TreeSchemasRelayUse {
    pub(crate) schema_use: TypeUse,
    pub(crate) direction: Direction,
}

/// What the relay routes of the api copy: the declarations this api lacks, and every copied use.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct TreeSchemasRelayCopies {
    pub(crate) schemas: Vec<Schema>,
    pub(crate) enums: Vec<Enum>,
    pub(crate) scalars: Vec<Scalar>,
    pub(crate) extension_keys: Vec<ExtensionKeyDecl>,
    pub(crate) uses: Vec<TreeSchemasRelayUse>,
}

/// How a kind of declaration is named in messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeclarationKind {
    Schema,
    Enum,
    NamedFormat,
    ExtensionKey,
}

impl DeclarationKind {
    fn text(self) -> &'static str {
        match self {
            Self::Schema => "schema",
            Self::Enum => "enum",
            Self::NamedFormat => "named format",
            Self::ExtensionKey => "extension key",
        }
    }
}

/// A declaration a relay copies.
#[derive(Debug, Clone, PartialEq)]
enum Declaration {
    Schema(Box<Schema>),
    Enum(Enum),
    Scalar(Scalar),
    ExtensionKey(ExtensionKeyDecl),
}

impl Declaration {
    fn id(&self) -> Result<&str, PassError> {
        Ok(match self {
            Self::Schema(schema) => match KnownSchemaRef::try_from(schema.as_ref())? {
                KnownSchemaRef::Object(object) => object.id.as_str(),
                KnownSchemaRef::Map(map) => map.id.as_str(),
                KnownSchemaRef::Union(union) => union.id.as_str(),
            },
            Self::Enum(declared) => declared.id.as_str(),
            Self::Scalar(declared) => declared.id.as_str(),
            Self::ExtensionKey(declared) => declared.id.as_str(),
        })
    }

    fn origin_pointer(&self) -> Result<&str, PassError> {
        Ok(match self {
            Self::Schema(schema) => schema.origin()?.pointer.as_str(),
            Self::Enum(declared) => declared.origin.pointer.as_str(),
            Self::Scalar(declared) => declared.origin.pointer.as_str(),
            Self::ExtensionKey(declared) => declared.origin.pointer.as_str(),
        })
    }

    /// The declaration as the JSON the comparison and the origin stamping read.
    fn encoded(&self) -> Result<JsonValue, PassError> {
        match self {
            Self::Schema(schema) => encoded(serde_json::to_value(schema.as_ref())),
            Self::Enum(declared) => encoded(serde_json::to_value(declared)),
            Self::Scalar(declared) => encoded(serde_json::to_value(declared)),
            Self::ExtensionKey(declared) => encoded(serde_json::to_value(declared)),
        }
    }

    /// The declaration of the same kind that `value` encodes.
    fn decoded_like(&self, value: &JsonValue) -> Result<Self, PassError> {
        let json = serde_json::to_value(value).map_err(decode_failure)?;

        Ok(match self {
            Self::Schema(_) => Self::Schema(Box::new(
                serde_json::from_value(json).map_err(decode_failure)?,
            )),
            Self::Enum(_) => Self::Enum(serde_json::from_value(json).map_err(decode_failure)?),
            Self::Scalar(_) => Self::Scalar(serde_json::from_value(json).map_err(decode_failure)?),
            Self::ExtensionKey(_) => {
                Self::ExtensionKey(serde_json::from_value(json).map_err(decode_failure)?)
            }
        })
    }
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "the callback of every map_err that reads a copy"
)]
fn decode_failure(failure: serde_json::Error) -> PassError {
    PassError::from(InternalError::new(format!(
        "tree.schemas cannot read a copied declaration back: {failure}"
    )))
}

/// Each catalogue a copy is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CatalogueName {
    Schemas,
    Enums,
    Scalars,
    ExtensionKeys,
}

impl CatalogueName {
    /// The member of the IR holding the catalogue.
    const fn member(self) -> &'static str {
        match self {
            Self::Schemas => "schemas",
            Self::Enums => "enums",
            Self::Scalars => "scalars",
            Self::ExtensionKeys => "extensionKeys",
        }
    }

    fn kind(self) -> DeclarationKind {
        match self {
            Self::Schemas => DeclarationKind::Schema,
            Self::Enums => DeclarationKind::Enum,
            Self::Scalars => DeclarationKind::NamedFormat,
            Self::ExtensionKeys => DeclarationKind::ExtensionKey,
        }
    }
}

/// The operation members a relay route's copied shape is read from, in the source it comes from.
#[derive(Debug, Clone, Copy)]
enum RelayedOperation<'source> {
    Draft(&'source DraftOperation),
    Contract(&'source Operation),
}

/// This api's declarations a copy is compared with, by id.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TreeSchemasLocalDeclarations<'local> {
    pub(crate) enums: &'local [Enum],
    pub(crate) extension_keys: &'local [ExtensionKeyDecl],
}

/// The api a relay copies from: a workspace api that ran, or an import.
#[derive(Debug, Clone, Copy)]
enum CopySource<'source> {
    Draft(&'source DraftIr),
    Contract(&'source ImportedIr),
}

impl<'source> CopySource<'source> {
    const fn schemas(self) -> &'source IrMap<SchemaId, Schema> {
        match self {
            Self::Draft(draft) => &draft.schemas,
            Self::Contract(imported) => &imported.contract().schemas,
        }
    }

    const fn enums(self) -> &'source IrMap<EnumId, Enum> {
        match self {
            Self::Draft(draft) => &draft.enums,
            Self::Contract(imported) => &imported.contract().enums,
        }
    }

    const fn scalars(self) -> &'source IrMap<ScalarId, Scalar> {
        match self {
            Self::Draft(draft) => &draft.scalars,
            Self::Contract(imported) => &imported.contract().scalars,
        }
    }

    const fn extension_keys(self) -> &'source IrMap<ExtensionKeyId, ExtensionKeyDecl> {
        match self {
            Self::Draft(draft) => &draft.extension_keys,
            Self::Contract(imported) => &imported.contract().extension_keys,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct CopySite<'source, 'site> {
    source: CopySource<'source>,
    api: &'site str,
    /// The pointer of the route's `relays` member, where a conflict is reported.
    pointer: &'site str,
    relays: &'site str,
}

/// The first status of an error response: the copied shape holds the success responses only.
const ERROR_STATUS: u16 = 400;

/// The members holding values the contract wrote: compared whole, since an `origin` key there is
/// data.
const WRITTEN_VALUE_MEMBERS: [&str; 4] = ["default", "examples", "extensions", "params"];

/// The members a comparison of two copies of one declaration leaves out.
const IGNORED_MEMBERS: [&str; 2] = ["directions", "origin"];

/// The first copy of a declaration, with the route that made it.
#[derive(Debug, Clone)]
struct FirstCopy {
    declaration: Declaration,
    /// The pointer of the route's `relays` member.
    pointer: String,
    relays: String,
}

/// The members of a relayed operation a copied shape is read from.
struct OperationMembers<'operation> {
    params: Option<&'operation Params>,
    input_schema: Option<&'operation TypeUse>,
    responses: &'operation [Response],
}

impl<'operation> From<RelayedOperation<'operation>> for OperationMembers<'operation> {
    fn from(operation: RelayedOperation<'operation>) -> Self {
        match operation {
            RelayedOperation::Draft(draft) => Self {
                params: draft.params.as_ref(),
                input_schema: draft
                    .input
                    .as_ref()
                    .map(|input| DraftOperationInputRef::from(input).schema),
                responses: draft.responses.as_deref().unwrap_or(&[]),
            },
            RelayedOperation::Contract(contract) => Self {
                params: Some(&contract.params),
                input_schema: contract
                    .input
                    .as_ref()
                    .map(|input| DraftOperationInputRef::from(input).schema),
                responses: &contract.responses,
            },
        }
    }
}

/// A member the public api's tree.nodes has not written holds no use to copy.
fn operation_uses(operation: RelayedOperation<'_>) -> Vec<TreeSchemasRelayUse> {
    let members = OperationMembers::from(operation);
    let read = |schema_use: &TypeUse| TreeSchemasRelayUse {
        schema_use: schema_use.clone(),
        direction: Direction::Input,
    };
    let written = |schema_use: &TypeUse| TreeSchemasRelayUse {
        schema_use: schema_use.clone(),
        direction: Direction::Output,
    };
    let mut uses: Vec<TreeSchemasRelayUse> = Vec::new();

    if let Some(params) = members.params {
        let listed = params
            .path
            .iter()
            .chain(&params.query)
            .chain(&params.header);

        uses.extend(listed.map(|param| read(&param.r#type)));
    }

    uses.extend(members.input_schema.map(read));

    for response in members
        .responses
        .iter()
        .filter(|response| response.status < i64::from(ERROR_STATUS))
    {
        uses.extend(response.body.as_ref().map(written));
        uses.extend(
            response
                .headers
                .iter()
                .map(|header| written(&header.r#type)),
        );
    }

    uses
}

/// A copied declaration passed the IR's closed check, so an `origin` or `derivedFrom.from` member
/// there is an origin.
fn is_copied_origin(value: &JsonValue) -> bool {
    let JsonValue::Object(object) = value else {
        return false;
    };

    matches!(object.get("layer"), Some(JsonValue::String(_)))
        && matches!(object.get("pointer"), Some(JsonValue::String(_)))
}

fn with_api_origin(origin: &mut JsonValue, api: &str) -> Result<(), PassError> {
    if !is_copied_origin(origin) {
        return Ok(());
    }

    let json = serde_json::to_value(&*origin).map_err(decode_failure)?;
    let read: Origin = serde_json::from_value(json).map_err(decode_failure)?;
    let stamped = tree_nodes_relay_origin(&read, api);

    if let (JsonValue::Object(object), Some(stamped_api)) = (origin, stamped.api) {
        object.insert("api".to_owned(), JsonValue::String(stamped_api));
    }

    Ok(())
}

/// Every origin of a copied declaration keeps its pointer and layer and names the public api: each
/// `origin` and each origin of a `derivedFrom.from`. A value the contract wrote is never entered:
/// an `origin` there is data.
fn with_api_origins(value: &mut JsonValue, api: &str) -> Result<(), PassError> {
    match value {
        JsonValue::Array(items) => {
            for item in items {
                with_api_origins(item, api)?;
            }
        }
        JsonValue::Object(object) => with_api_origins_of_members(object, api)?,
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {}
    }

    Ok(())
}

fn with_api_origins_of_members(object: &mut JsonObject, api: &str) -> Result<(), PassError> {
    let keys: Vec<String> = object.keys().cloned().collect();

    for key in keys {
        let Some(member) = object.get_mut(&key) else {
            continue;
        };

        if key == "origin" {
            with_api_origin(member, api)?;
        }

        if key == "derivedFrom"
            && let JsonValue::Object(derived) = member
            && let Some(JsonValue::Array(origins)) = derived.get_mut("from")
        {
            for origin in origins {
                with_api_origin(origin, api)?;
            }
        }

        if !WRITTEN_VALUE_MEMBERS.contains(&key.as_str()) {
            with_api_origins(member, api)?;
        }
    }

    Ok(())
}

fn without_ignored(value: &JsonValue) -> JsonValue {
    match value {
        JsonValue::Array(items) => JsonValue::Array(items.iter().map(without_ignored).collect()),
        JsonValue::Object(object) => {
            let mut kept = JsonObject::new();

            for (key, member) in object
                .iter()
                .filter(|(key, _)| !IGNORED_MEMBERS.contains(&key.as_str()))
            {
                kept.insert(key.clone(), compared_member(key, member));
            }

            JsonValue::Object(kept)
        }
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {
            value.clone()
        }
    }
}

/// A `derivedFrom.from` origin is compared without the api a copy marked on it, as an `origin` is
/// not compared.
fn compared_member(key: &str, member: &JsonValue) -> JsonValue {
    if WRITTEN_VALUE_MEMBERS.contains(&key) {
        return member.clone();
    }

    let JsonValue::Object(derived) = member else {
        return without_ignored(member);
    };

    if key != "derivedFrom" || !derived.contains_key("from") {
        return without_ignored(member);
    }

    let from: Vec<JsonValue> = match derived.get("from") {
        Some(JsonValue::Array(origins)) => origins.iter().map(without_origin_api).collect(),
        _ => Vec::new(),
    };
    let mut replaced = derived.clone();

    replaced.insert("from".to_owned(), JsonValue::Array(from));

    without_ignored(&JsonValue::Object(replaced))
}

fn without_origin_api(origin: &JsonValue) -> JsonValue {
    let JsonValue::Object(object) = origin else {
        return origin.clone();
    };

    if !is_copied_origin(origin) {
        return origin.clone();
    }

    let mut located = object.clone();

    located.remove("api");

    JsonValue::Object(located)
}

/// What two declarations of one name must agree on: everything but the directions, which each api
/// takes from its own uses, and the origins, which name the file and the api each copy was read
/// from.
fn content_of(declaration: &Declaration) -> Result<String, PassError> {
    Ok(canonical_json(&without_ignored(&declaration.encoded()?)))
}

/// The extension key ids a copied schema's values use: its own and its properties'.
fn extension_key_ids(schema: &Schema) -> Result<Vec<String>, PassError> {
    let mut slots = Vec::new();

    match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => {
            slots.push(&object.extensions);
            slots.extend(
                object
                    .properties
                    .iter()
                    .map(|property| &property.extensions),
            );
        }
        KnownSchemaRef::Map(map) => slots.push(&map.extensions),
        KnownSchemaRef::Union(union) => slots.push(&union.extensions),
    }

    Ok(slots
        .into_iter()
        .flat_map(|slot| slot.iter())
        .flat_map(|(prefix, keys)| {
            keys.keys()
                .map(move |key| format!("{}-{}", prefix.as_str(), key.as_str()))
        })
        .collect())
}

/// A declaration read from a catalogue: it is closed, or the unknowns it holds.
type ReadDeclaration = Result<Declaration, Vec<IrClosedUnknown>>;

/// `declared` as a copy: an imported one passes the IR's closed check at its place in the document,
/// a workspace api's own draft holds only what this compiler writes.
fn read_declaration<T: IrClosedDeclaration + Clone>(
    declared: &T,
    source: CopySource<'_>,
    pointer: &str,
    wrap: fn(T) -> Declaration,
) -> Result<ReadDeclaration, PassError> {
    let CopySource::Contract(imported) = source else {
        return Ok(Ok(wrap(declared.clone())));
    };
    let check = check_ir_closed_declaration(declared, imported.document(), pointer)
        .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(match check {
        IrClosedCheck::Closed(closed) => Ok(wrap(closed.clone())),
        IrClosedCheck::Unknowns(unknowns) => Err(unknowns),
    })
}

/// The declaration of a catalogue that a copy was asked for, which is of another kind: a bug.
fn mismatched(catalogue: CatalogueName) -> PassError {
    PassError::from(InternalError::new(format!(
        "tree.schemas read a declaration of another kind from the {}",
        catalogue.member()
    )))
}

/// Copies the declarations the relay routes of one api use.
struct RelayCopier<'compiler, 'raw, 'half, 'run> {
    compiler: &'compiler mut TreeSchemasCompiler<'raw, 'half, 'run>,
    copies: TreeSchemasRelayCopies,
    seen: HashSet<String>,
    first_copies: IndexMap<String, FirstCopy>,
    enums: IndexMap<String, Enum>,
    extension_keys: IndexMap<String, ExtensionKeyDecl>,
}

impl<'compiler, 'raw, 'half, 'run> RelayCopier<'compiler, 'raw, 'half, 'run> {
    fn new(
        compiler: &'compiler mut TreeSchemasCompiler<'raw, 'half, 'run>,
        local: TreeSchemasLocalDeclarations<'_>,
    ) -> Self {
        Self {
            compiler,
            copies: TreeSchemasRelayCopies::default(),
            seen: HashSet::new(),
            first_copies: IndexMap::new(),
            enums: local
                .enums
                .iter()
                .map(|declared| (declared.id.as_str().to_owned(), declared.clone()))
                .collect(),
            extension_keys: local
                .extension_keys
                .iter()
                .map(|declared| (declared.id.as_str().to_owned(), declared.clone()))
                .collect(),
        }
    }

    fn copy_route(
        &mut self,
        site: CopySite<'_, '_>,
        operation: RelayedOperation<'_>,
    ) -> Result<(), PassError> {
        for relay_use in operation_uses(operation) {
            self.reach(site, &relay_use.schema_use)?;
            self.copies.uses.push(relay_use);
        }

        Ok(())
    }

    fn reach(&mut self, site: CopySite<'_, '_>, schema_use: &TypeUse) -> Result<(), PassError> {
        match KnownTypeUseRef::try_from(schema_use)? {
            KnownTypeUseRef::Ref(reference) => self.schema(site, reference.schema.as_str()),
            KnownTypeUseRef::Enum(enum_use) => self.enum_of(site, enum_use.r#enum.as_str()),
            KnownTypeUseRef::Array(array_use) => self.reach(site, &array_use.items),
            KnownTypeUseRef::Scalar(scalar_use) => {
                if let Some(scalar) = &scalar_use.scalar {
                    self.scalar(site, scalar.as_str())?;
                }

                match &scalar_use.content {
                    Some(content) => self.reach(site, &content.schema),
                    None => Ok(()),
                }
            }
            KnownTypeUseRef::File(_) | KnownTypeUseRef::Opaque(_) => Ok(()),
        }
    }

    fn schema(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        let Some(relayed) = self.copy_of(site, CatalogueName::Schemas, id)? else {
            return Ok(());
        };
        let Declaration::Schema(schema) = &relayed else {
            return Err(mismatched(CatalogueName::Schemas));
        };
        let local = self
            .compiler
            .schemas
            .get(id)
            .map(|declared| Declaration::Schema(Box::new(declared.clone())));

        self.join(site, DeclarationKind::Schema, &relayed, local.as_ref())?;

        for key_id in extension_key_ids(schema)? {
            self.extension_key(site, &key_id)?;
        }

        match KnownSchemaRef::try_from(schema.as_ref())? {
            KnownSchemaRef::Object(object) => {
                for property in &object.properties {
                    self.reach(site, &property.r#type)?;
                }
            }
            KnownSchemaRef::Map(map) => {
                if let Some(keys) = &map.keys {
                    self.reach(site, keys)?;
                }

                self.reach(site, &map.values)?;
            }
            KnownSchemaRef::Union(union) => {
                for variant in &union.variants {
                    self.schema(site, variant.schema.as_str())?;
                }
            }
        }

        Ok(())
    }

    fn enum_of(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        let Some(relayed) = self.copy_of(site, CatalogueName::Enums, id)? else {
            return Ok(());
        };
        let Declaration::Enum(declared) = &relayed else {
            return Err(mismatched(CatalogueName::Enums));
        };
        let local = self.enums.get(id).cloned().map(Declaration::Enum);

        self.join(site, DeclarationKind::Enum, &relayed, local.as_ref())?;

        if let Some(source) = &declared.source
            && let KnownEnumSourceRef::Enum(from) = KnownEnumSourceRef::try_from(source)?
        {
            return self.enum_of(site, from.r#enum.as_str());
        }

        Ok(())
    }

    fn extension_key(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        let Some(relayed) = self.copy_of(site, CatalogueName::ExtensionKeys, id)? else {
            return Ok(());
        };
        let Declaration::ExtensionKey(declared) = &relayed else {
            return Err(mismatched(CatalogueName::ExtensionKeys));
        };
        let local = self
            .extension_keys
            .get(id)
            .cloned()
            .map(Declaration::ExtensionKey);

        self.join(
            site,
            DeclarationKind::ExtensionKey,
            &relayed,
            local.as_ref(),
        )?;

        self.reach(site, &declared.schema)
    }

    fn scalar(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        let Some(relayed) = self.copy_of(site, CatalogueName::Scalars, id)? else {
            return Ok(());
        };
        let local = self
            .compiler
            .scalars
            .all(&mut self.compiler.reporter)?
            .into_iter()
            .find(|declared| declared.id.as_str() == id)
            .map(Declaration::Scalar);

        self.join(site, DeclarationKind::NamedFormat, &relayed, local.as_ref())
    }

    /// A declaration this api lacks is copied once; a later copy of that id from another api is
    /// compared with it.
    fn join(
        &mut self,
        site: CopySite<'_, '_>,
        kind: DeclarationKind,
        relayed: &Declaration,
        local: Option<&Declaration>,
    ) -> Result<(), PassError> {
        if let Some(local) = local {
            return Self::compare_local(&mut self.compiler.reporter, site, kind, relayed, local);
        }

        let first_key = format!("{}#{}", kind.text(), relayed.id()?);

        if let Some(first) = self.first_copies.get(&first_key) {
            return Self::compare_first(&mut self.compiler.reporter, site, kind, relayed, first);
        }

        let copied = Self::copied(relayed, site)?;

        match &copied {
            Declaration::Schema(schema) => self.copies.schemas.push(schema.as_ref().clone()),
            Declaration::Enum(declared) => self.copies.enums.push(declared.clone()),
            Declaration::Scalar(declared) => self.copies.scalars.push(declared.clone()),
            Declaration::ExtensionKey(declared) => {
                self.copies.extension_keys.push(declared.clone());
            }
        }

        self.first_copies.insert(
            first_key,
            FirstCopy {
                declaration: copied,
                pointer: site.pointer.to_owned(),
                relays: site.relays.to_owned(),
            },
        );

        Ok(())
    }

    /// A copy of a declaration of the public api, once per name and api; `None` once seen, or when
    /// it holds what this IR revision does not know (refused).
    fn copy_of(
        &mut self,
        site: CopySite<'_, '_>,
        catalogue: CatalogueName,
        id: &str,
    ) -> Result<Option<Declaration>, PassError> {
        let seen_key = format!("{}#{}:{id}", site.api, catalogue.member());
        let pointer = tree_schemas_pointer("", &[catalogue.member(), id]);
        let read = match catalogue {
            CatalogueName::Schemas => site.source.schemas().get(id).map(|declared| {
                read_declaration(declared, site.source, &pointer, |schema| {
                    Declaration::Schema(Box::new(schema))
                })
            }),
            CatalogueName::Enums => site.source.enums().get(id).map(|declared| {
                read_declaration(declared, site.source, &pointer, Declaration::Enum)
            }),
            CatalogueName::Scalars => site.source.scalars().get(id).map(|declared| {
                read_declaration(declared, site.source, &pointer, Declaration::Scalar)
            }),
            CatalogueName::ExtensionKeys => site.source.extension_keys().get(id).map(|declared| {
                read_declaration(declared, site.source, &pointer, Declaration::ExtensionKey)
            }),
        };

        let Some(read) = read else {
            return Ok(None);
        };

        if !self.seen.insert(seen_key) {
            return Ok(None);
        }

        match read? {
            Ok(declaration) => Ok(Some(declaration)),
            Err(unknowns) => {
                let copied = format!("the {} '{id}'", catalogue.kind().text());

                self.report_unknowns(site, &copied, &unknowns)?;

                Ok(None)
            }
        }
    }

    fn report_unknowns(
        &mut self,
        site: CopySite<'_, '_>,
        copied: &str,
        unknowns: &[IrClosedUnknown],
    ) -> Result<(), PassError> {
        let named: Vec<String> = unknowns
            .iter()
            .map(|unknown| format!("{} at {}", quote_text(&unknown.value), unknown.pointer))
            .collect();

        self.compiler.reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::RelayUnknown,
            pointer: site.pointer.to_owned(),
            message: format!(
                "{copied} that {} uses holds what this compiler does not know ({}), so it is not copied",
                site.relays,
                named.join(", ")
            ),
            fix: format!(
                "compile with a seampact version that reads the IR of {}, or relay another operation",
                site.api
            ),
            related: None,
        })
    }

    fn copied(relayed: &Declaration, site: CopySite<'_, '_>) -> Result<Declaration, PassError> {
        let mut encoded_copy = relayed.encoded()?;

        with_api_origins(&mut encoded_copy, site.api)?;

        // This api writes the directions from its own uses; an extension key has none.
        if let JsonValue::Object(object) = &mut encoded_copy
            && object.contains_key("directions")
        {
            object.insert("directions".to_owned(), JsonValue::Array(Vec::new()));
        }

        relayed.decoded_like(&encoded_copy)
    }

    fn compare_local(
        reporter: &mut TreeSchemasReporter<'_, '_>,
        site: CopySite<'_, '_>,
        kind: DeclarationKind,
        relayed: &Declaration,
        local: &Declaration,
    ) -> Result<(), PassError> {
        if content_of(relayed)? == content_of(local)? {
            return Ok(());
        }

        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::RelayDeclaration,
            pointer: site.pointer.to_owned(),
            message: format!(
                "the {} '{}' that {} uses differs from the one this api declares",
                kind.text(),
                relayed.id()?,
                site.relays
            ),
            fix: "declare it once in a shared file both apis load, or rename one of them"
                .to_owned(),
            related: Some(vec![TreeSchemasRelated {
                pointer: local.origin_pointer()?.to_owned(),
                message: format!("this api's {} '{}'", kind.text(), local.id()?),
            }]),
        })
    }

    fn compare_first(
        reporter: &mut TreeSchemasReporter<'_, '_>,
        site: CopySite<'_, '_>,
        kind: DeclarationKind,
        relayed: &Declaration,
        first: &FirstCopy,
    ) -> Result<(), PassError> {
        if content_of(relayed)? == content_of(&first.declaration)? {
            return Ok(());
        }

        reporter.error(TreeSchemasProblem {
            rule: TreeSchemasRule::RelayDeclaration,
            pointer: site.pointer.to_owned(),
            message: format!(
                "the {} '{}' that {} uses differs from the one {} uses",
                kind.text(),
                relayed.id()?,
                site.relays,
                first.relays
            ),
            fix: "declare it once in a shared file both public apis load, or rename one of them"
                .to_owned(),
            related: Some(vec![TreeSchemasRelated {
                pointer: first.pointer.clone(),
                message: format!("the route relaying {}", first.relays),
            }]),
        })
    }
}

/// The operation a relay target names, in the api that ran or the import, with where it comes from.
fn public_operation<'context>(
    context: &'context HalfContext<'_>,
    target: &RelayTarget,
) -> Result<Option<(CopySource<'context>, RelayedOperation<'context>)>, PassError> {
    if let Some(relayed) = context.relayed(&target.api) {
        let operation = relayed
            .operations
            .iter()
            .find(|each| each.id.as_ref().is_some_and(|id| id.as_str() == target.id));

        return Ok(operation.map(|operation| {
            (
                CopySource::Draft(relayed),
                RelayedOperation::Draft(operation),
            )
        }));
    }

    let Some(imported) = context.imported_ir(&target.api) else {
        return Ok(None);
    };
    let found = imported
        .contract()
        .operations
        .iter()
        .enumerate()
        .find(|(_, each)| each.id.as_str() == target.id);
    let Some((index, operation)) = found else {
        return Ok(None);
    };
    let pointer = tree_schemas_pointer("", &["operations", &index.to_string()]);
    let check = check_ir_closed_declaration(operation, imported.document(), &pointer)
        .map_err(|error| InternalError::new(error.to_string()))?;

    Ok(match check {
        IrClosedCheck::Closed(closed) => Some((
            CopySource::Contract(imported),
            RelayedOperation::Contract(closed),
        )),
        IrClosedCheck::Unknowns(_) => None,
    })
}

/// Copies the declarations every relay route of the tree uses and answers them with the copied
/// uses.
pub(crate) fn tree_schemas_copy_relay_declarations(
    compiler: &mut TreeSchemasCompiler<'_, '_, '_>,
    local: TreeSchemasLocalDeclarations<'_>,
    nodes: &TreeNodes<'_>,
    context: &HalfContext<'_>,
) -> Result<TreeSchemasRelayCopies, PassError> {
    let mut copier = RelayCopier::new(compiler, local);

    for (_, node) in nodes.iter() {
        if node.kind != TreeNodeKind::Relay {
            continue;
        }

        let Some(relays) = node.settings.get("relays") else {
            continue;
        };
        let JsonValue::String(written) = relays else {
            continue;
        };
        let Some(target) = relay_target(written) else {
            continue;
        };
        let Some((source, operation)) = public_operation(context, &target)? else {
            continue;
        };
        let pointer = tree_schemas_pointer(&node.pointer, &["relays"]);

        copier.copy_route(
            CopySite {
                source,
                api: &target.api,
                pointer: &pointer,
                relays: &target.text,
            },
            operation,
        )?;
    }

    Ok(copier.copies)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(text: &str) -> JsonValue {
        let parsed: serde_json::Value = serde_json::from_str(text).expect("test JSON");

        JsonValue::try_from(parsed).expect("test JSON value")
    }

    #[test]
    fn a_copied_origin_names_the_api_but_a_written_value_is_never_entered() {
        let mut copied = json(
            r#"{"origin":{"layer":"api","pointer":"/a"},
                "core":{"origin":{"layer":"core","pointer":"/c"}},
                "derivedFrom":{"from":[{"layer":"base","pointer":"/b"}]},
                "examples":[{"origin":{"layer":"api","pointer":"/data"}}],
                "own":{"origin":{"api":"other","layer":"api","pointer":"/o"}}}"#,
        );

        with_api_origins(&mut copied, "public").expect("stamped");

        let expected = json(
            r#"{"origin":{"api":"public","layer":"api","pointer":"/a"},
                "core":{"origin":{"layer":"core","pointer":"/c"}},
                "derivedFrom":{"from":[{"api":"public","layer":"base","pointer":"/b"}]},
                "examples":[{"origin":{"layer":"api","pointer":"/data"}}],
                "own":{"origin":{"api":"other","layer":"api","pointer":"/o"}}}"#,
        );

        assert_eq!(copied, expected);
    }

    #[test]
    fn two_copies_compare_equal_without_directions_origins_and_the_copy_api() {
        let first = json(
            r#"{"id":"A","directions":["input"],"origin":{"layer":"api","pointer":"/a"},
                "derivedFrom":{"from":[{"api":"x","layer":"api","pointer":"/p"}]},
                "examples":[{"origin":1}]}"#,
        );
        let second = json(
            r#"{"id":"A","directions":[],"origin":{"layer":"base","pointer":"/z"},
                "derivedFrom":{"from":[{"layer":"api","pointer":"/p"}]},
                "examples":[{"origin":1}]}"#,
        );
        let different = json(
            r#"{"id":"A","directions":[],"derivedFrom":{"from":[]},"examples":[{"origin":2}]}"#,
        );

        assert_eq!(
            canonical_json(&without_ignored(&first)),
            canonical_json(&without_ignored(&second))
        );
        assert_ne!(
            canonical_json(&without_ignored(&first)),
            canonical_json(&without_ignored(&different))
        );
    }
}
