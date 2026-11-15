//! Relay-copied declarations: the schemas, enums and named formats a relay route's copied shape uses
//! join this api, each keeping its origin in the public api with `api` naming it. The public api is a
//! workspace api that ran (`relayed`) or an import. The copied uses also give this api's declarations
//! their directions: a parameter or the body input is read, a success response written. Nothing about
//! access is copied, so a rule's proof schema is not.

use indexmap::IndexMap;
use std::collections::HashSet;

use seampact_ir::{
    ContractIr, Direction, Enum, ExtensionKeyDecl, Operation, Scalar, Schema, TypeUse,
};
use seampact_json::{JsonValue, canonical_json};
use seampact_pipeline::{DraftIr, DraftOperation, HalfContext, PassError, TreeNodeKind, TreeNodes};

use crate::compile::TreeSchemasCompiler;
use crate::not_ported::not_ported_yet;
use crate::operations::encoded;
use crate::raw::tree_schemas_pointer;

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

/// Each catalogue a copy is read from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CatalogueName {
    Schemas,
    Enums,
    Scalars,
    ExtensionKeys,
}

impl CatalogueName {
    /// The IR definition a copy is checked against.
    fn definition(self) -> &'static str {
        match self {
            Self::Schemas => "Schema",
            Self::Enums => "Enum",
            Self::Scalars => "Scalar",
            Self::ExtensionKeys => "ExtensionKeyDecl",
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
    Contract(&'source ContractIr),
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

/// A member a closed declaration holds that the IR does not define.
///
/// A plain copy of the IR's closed-declaration result, until `seampact-ir` has that module.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TreeSchemasClosedUnknown {
    pointer: String,
    value: String,
}

#[derive(Debug, Clone)]
struct FirstCopy<'source, 'site> {
    declaration: Declaration,
    site: CopySite<'source, 'site>,
}

/// A relay target: the api and operation id `relays: <api>.<operationId>` names.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RelayTarget {
    api: String,
    operation_id: String,
}

/// `relays: <api>.<operationId>`: the api is the text before the first dot.
fn relay_target(relays: &JsonValue) -> Option<RelayTarget> {
    let JsonValue::String(text) = relays else {
        return None;
    };
    let (api, operation_id) = text.split_once('.')?;

    if api.is_empty() {
        return None;
    }

    Some(RelayTarget {
        api: api.to_owned(),
        operation_id: operation_id.to_owned(),
    })
}

fn operation_uses(operation: RelayedOperation<'_>) -> Result<Vec<TreeSchemasRelayUse>, PassError> {
    Err(not_ported_yet("operationUses"))
}

fn is_copied_origin(value: &JsonValue) -> Result<bool, PassError> {
    Err(not_ported_yet("isCopiedOrigin"))
}

fn with_api_origin(origin: &mut JsonValue, api: &str) -> Result<(), PassError> {
    Err(not_ported_yet("withApiOrigin"))
}

fn with_api_origins(value: &mut JsonValue, api: &str) -> Result<(), PassError> {
    Err(not_ported_yet("withApiOrigins"))
}

fn without_ignored(value: &JsonValue) -> Result<JsonValue, PassError> {
    Err(not_ported_yet("withoutIgnored"))
}

fn compared_member(key: &str, member: &JsonValue) -> Result<JsonValue, PassError> {
    Err(not_ported_yet("comparedMember"))
}

fn without_origin_api(origin: &JsonValue) -> Result<JsonValue, PassError> {
    Err(not_ported_yet("withoutOriginApi"))
}

fn content_of(declaration: &Declaration) -> Result<String, PassError> {
    let encoded_declaration = match declaration {
        Declaration::Schema(schema) => encoded(serde_json::to_value(schema.as_ref())),
        Declaration::Enum(declared) => encoded(serde_json::to_value(declared)),
        Declaration::Scalar(declared) => encoded(serde_json::to_value(declared)),
        Declaration::ExtensionKey(declared) => encoded(serde_json::to_value(declared)),
    }?;

    Ok(canonical_json(&without_ignored(&encoded_declaration)?))
}

fn extension_key_ids(schema: &Schema) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("extensionKeyIds"))
}

/// Copies the declarations the relay routes of one api use.
struct RelayCopier<'compiler, 'source, 'site, 'raw, 'half, 'run> {
    compiler: &'compiler mut TreeSchemasCompiler<'raw, 'half, 'run>,
    copies: TreeSchemasRelayCopies,
    seen: HashSet<String>,
    first_copies: IndexMap<String, FirstCopy<'source, 'site>>,
    enums: IndexMap<String, Enum>,
    extension_keys: IndexMap<String, ExtensionKeyDecl>,
}

impl<'compiler, 'raw, 'half, 'run> RelayCopier<'compiler, '_, '_, 'raw, 'half, 'run> {
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
        Err(not_ported_yet("RelayCopier.copyRoute"))
    }

    fn reach(&mut self, site: CopySite<'_, '_>, schema_use: &TypeUse) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.reach"))
    }

    fn schema(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.schema"))
    }

    fn enum_of(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.enumOf"))
    }

    fn extension_key(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.extensionKey"))
    }

    fn scalar(&mut self, site: CopySite<'_, '_>, id: &str) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.scalar"))
    }

    fn join(
        &mut self,
        site: CopySite<'_, '_>,
        kind: DeclarationKind,
        relayed: Declaration,
        local: Option<&Declaration>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.join"))
    }

    fn copy_of(
        &mut self,
        site: CopySite<'_, '_>,
        catalogue: CatalogueName,
        id: &str,
    ) -> Result<Option<Declaration>, PassError> {
        Err(not_ported_yet("RelayCopier.copyOf"))
    }

    fn report_unknowns(
        &mut self,
        site: CopySite<'_, '_>,
        copied: &str,
        unknowns: &[TreeSchemasClosedUnknown],
    ) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.reportUnknowns"))
    }

    fn copied(
        &self,
        relayed: &Declaration,
        site: CopySite<'_, '_>,
    ) -> Result<Declaration, PassError> {
        Err(not_ported_yet("RelayCopier.copied"))
    }

    fn compare_local(
        &mut self,
        site: CopySite<'_, '_>,
        kind: DeclarationKind,
        relayed: &Declaration,
        local: &Declaration,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.compareLocal"))
    }

    fn compare_first(
        &mut self,
        site: CopySite<'_, '_>,
        kind: DeclarationKind,
        relayed: &Declaration,
        first: &FirstCopy<'_, '_>,
    ) -> Result<(), PassError> {
        Err(not_ported_yet("RelayCopier.compareFirst"))
    }
}

/// The operation a relay target names, in the api that ran or the import, with where it comes from.
fn public_operation<'context>(
    context: &'context HalfContext<'_>,
    target: &RelayTarget,
) -> Result<Option<(CopySource<'context>, RelayedOperation<'context>)>, PassError> {
    if let Some(relayed) = context.relayed(&target.api) {
        let operation = relayed.operations.iter().find(|each| {
            each.id
                .as_ref()
                .is_some_and(|id| id.as_str() == target.operation_id)
        });

        return Ok(operation.map(|operation| {
            (
                CopySource::Draft(relayed),
                RelayedOperation::Draft(operation),
            )
        }));
    }

    let imported_operation = context.imported(&target.api).is_some_and(|imported| {
        imported
            .operations
            .iter()
            .any(|each| each.id.as_str() == target.operation_id)
    });

    if imported_operation {
        // The closed check of an imported operation is the foreign `checkIrClosedDeclaration`.
        return Err(not_ported_yet("checkIrClosedDeclaration"));
    }

    Ok(None)
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
        let Some(target) = relay_target(relays) else {
            continue;
        };
        let Some((source, operation)) = public_operation(context, &target)? else {
            continue;
        };
        let pointer = tree_schemas_pointer(&node.pointer, &["relays"]);
        let relays_text = format!("{}.{}", target.api, target.operation_id);

        copier.copy_route(
            CopySite {
                source,
                api: &target.api,
                pointer: &pointer,
                relays: &relays_text,
            },
            operation,
        )?;
    }

    Ok(copier.copies)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(text: &str) -> Option<(String, String)> {
        relay_target(&JsonValue::String(text.to_owned()))
            .map(|found| (found.api, found.operation_id))
    }

    #[test]
    fn a_relay_target_splits_at_the_first_dot_and_needs_an_api() {
        assert_eq!(
            target("public.listUsers"),
            Some(("public".to_owned(), "listUsers".to_owned()))
        );
        assert_eq!(
            target("public.a.b"),
            Some(("public".to_owned(), "a.b".to_owned()))
        );
        assert_eq!(
            target("public."),
            Some(("public".to_owned(), String::new()))
        );
        assert_eq!(target(".listUsers"), None);
        assert_eq!(target("nodot"), None);
        assert_eq!(relay_target(&JsonValue::Null), None);
    }
}
