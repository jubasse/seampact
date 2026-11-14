//! Operation ids and names (ADR 0002 section 6, ADR 0007 sections 2 and 3).
//!
//! An operation's words are a verb (the op, or the route name) and a noun (the plural, the
//! singular, a single's name, or none under a surface root); `conventions.operationIds.order`
//! puts them in order, `case` spells the id. `operationId` replaces both, and a relay route's name
//! is the public operation id, so its words are its own name's.

use indexmap::IndexMap;
use seampact_authoring::RawApi;
use seampact_diagnostics::InternalError;
use seampact_ir::{Name, NameRole, OpShorthand};
use seampact_js::{FiniteNumber, js_key_order};
use seampact_json::JsonValue;
use seampact_naming::{NamingError, OperationIdCase, operation_id, split_name};
use seampact_pipeline::{
    ResolvedConventions, TreeNode, TreeNodeKind, TreeNodes, pipeline_tree_nodes,
};

use crate::raw::{tree_nodes_member, tree_nodes_setting, tree_nodes_text};

/// The id and the name of one operation.
#[derive(Debug, Clone, PartialEq)]
pub struct TreeNodesOperationName {
    /// The operation id.
    pub id: String,
    /// The operation's canonical name.
    pub name: Name,
}

/// The declared schemas of the merged raw tree (`raw.merged.schemas`), which a fields map may name.
pub type TreeNodesRawSchemas<'raw> = Option<&'raw JsonValue>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdOrder {
    VerbNoun,
    NounVerb,
}

// ADR 0002 section 6: the batch op reads as `get` + plural + `Batch` (`getTasksBatch`).
const BATCH_VERB: &str = "get";
const BATCH_SUFFIX: &str = "batch";

// The id parameter suffix the singular drops (`taskId` gives `task`).
const ID_SUFFIX: &str = "Id";

// An id parameter with no noun in it.
const BARE_ID_PARAM: &str = "id";

// The ops whose noun is the plural; the others take the singular.
const PLURAL_OPS: [&str; 2] = ["list", "batch"];

/// The `list` op shorthand.
pub const TREE_NODES_LIST_OP: OpShorthand = OpShorthand::List;

/// The `delete` op shorthand.
pub const TREE_NODES_DELETE_OP: OpShorthand = OpShorthand::Delete;

/// The `batch` op shorthand.
pub const TREE_NODES_BATCH_OP: OpShorthand = OpShorthand::Batch;

const MEMBER_SCOPE: &str = "member";

/// Whether a tree node is an operation: a route, a relay route or an `ops` entry.
#[must_use]
pub fn tree_nodes_is_operation(node: &TreeNode<'_>) -> bool {
    matches!(
        node.kind,
        TreeNodeKind::Route | TreeNodeKind::Relay | TreeNodeKind::Op
    )
}

/// The id parameter of a collection: the one key of its `id` fields map, or the one property of
/// the schema it names (ADR 0002 section 4: `id: TaskKey`).
///
/// `None` when the named schema is not declared with properties.
#[must_use]
pub fn tree_nodes_id_param(
    collection: &TreeNode<'_>,
    schemas: TreeNodesRawSchemas<'_>,
) -> Option<String> {
    let id = tree_nodes_setting(collection, "id");
    let fields = match id {
        Some(JsonValue::String(schema_name)) => {
            tree_nodes_member(tree_nodes_member(schemas, schema_name), "properties")
        }
        other => other,
    };
    let Some(JsonValue::Object(properties)) = fields else {
        return None;
    };

    js_key_order(properties.iter())
        .next()
        .map(|(key, _)| key.clone())
}

/// Whether a collection writes `id`, as a fields map or a schema name.
fn declares_id(collection: &TreeNode<'_>) -> bool {
    collection.settings.contains_key("id")
}

// The singular of a collection: `singular`, else the id parameter without its `Id` suffix, else
// the whole parameter; `None` when it declares neither (ADR 0002 section 6 gives no third source).
fn singular_words(
    collection: &TreeNode<'_>,
    schemas: TreeNodesRawSchemas<'_>,
) -> Option<Vec<String>> {
    if let Some(singular) = tree_nodes_text(collection, "singular") {
        return Some(split_name(singular));
    }

    let id_param = tree_nodes_id_param(collection, schemas)?;
    let stem = match id_param.strip_suffix(ID_SUFFIX) {
        Some(stem) if !stem.is_empty() => stem,
        _ => id_param.as_str(),
    };

    Some(split_name(stem))
}

/// Whether the singular of a collection is the bare id parameter `id`, which reads `getId` in an
/// operation id.
#[must_use]
pub fn tree_nodes_singular_is_bare_id(
    collection: &TreeNode<'_>,
    schemas: TreeNodesRawSchemas<'_>,
) -> bool {
    tree_nodes_text(collection, "singular").is_none()
        && tree_nodes_id_param(collection, schemas).as_deref() == Some(BARE_ID_PARAM)
}

/// The shorthand of an `ops` entry; `None` for any other node.
#[must_use]
pub fn tree_nodes_op_shorthand(node: &TreeNode<'_>) -> Option<OpShorthand> {
    if node.kind != TreeNodeKind::Op {
        return None;
    }

    OpShorthand::known(&node.name)
}

/// The collection or single an op entry belongs to: an op's parent is its scope, or the single it
/// is written on.
///
/// # Errors
///
/// An [`InternalError`] for a node of another list.
pub fn tree_nodes_op_owner<'nodes, 'raw>(
    nodes: &'nodes TreeNodes<'raw>,
    op: &TreeNode<'raw>,
) -> Result<Option<&'nodes TreeNode<'raw>>, InternalError> {
    let Some(parent_id) = op.parent else {
        return Ok(None);
    };
    let parent = nodes.get(parent_id)?;

    if parent.kind != TreeNodeKind::Scope {
        return Ok(Some(parent));
    }

    parent
        .parent
        .map(|owner_id| nodes.get(owner_id))
        .transpose()
}

/// The nearest collection without `id` whose member scope holds the operation node.
///
/// Its member path has no id parameter (ADR 0002 section 6), so the operation is refused and
/// left out.
///
/// # Errors
///
/// An [`InternalError`] for a node of another list.
pub fn tree_nodes_idless_collection<'nodes, 'raw>(
    nodes: &'nodes TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<&'nodes TreeNode<'raw>>, InternalError> {
    let mut at = node.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;
        let collection_id = (current.kind == TreeNodeKind::Scope && current.name == MEMBER_SCOPE)
            .then_some(current.parent)
            .flatten();

        if let Some(collection_id) = collection_id {
            let collection = nodes.get(collection_id)?;

            if !declares_id(collection) {
                return Ok(Some(collection));
            }
        }

        at = current.parent;
    }

    Ok(None)
}

/// The collection whose singular names an operation node: the collection of a member-scope route
/// or of an op that reads one record.
///
/// `None` when the noun is a plural, a single's name or none.
///
/// # Errors
///
/// An [`InternalError`] for a node of another list.
pub fn tree_nodes_singular_owner<'nodes, 'raw>(
    nodes: &'nodes TreeNodes<'raw>,
    node: &TreeNode<'raw>,
) -> Result<Option<&'nodes TreeNode<'raw>>, InternalError> {
    if node.kind == TreeNodeKind::Op {
        let owner = tree_nodes_op_owner(nodes, node)?;

        return Ok(owner.filter(|found| {
            found.kind == TreeNodeKind::Collection && !PLURAL_OPS.contains(&node.name.as_str())
        }));
    }

    let Some(parent_id) = node.parent else {
        return Ok(None);
    };
    let parent = nodes.get(parent_id)?;

    if parent.kind != TreeNodeKind::Scope || parent.name != MEMBER_SCOPE {
        return Ok(None);
    }

    parent
        .parent
        .map(|owner_id| nodes.get(owner_id))
        .transpose()
}

struct Words {
    verb: Vec<String>,
    noun: Vec<String>,
}

// The verb and noun words of an operation node, before the order is applied; `None` when the noun
// is the singular of a collection that gives none.
fn words_of<'raw>(
    nodes: &TreeNodes<'raw>,
    node: &TreeNode<'raw>,
    schemas: TreeNodesRawSchemas<'_>,
) -> Result<Option<Words>, InternalError> {
    let Some(singular_owner) = tree_nodes_singular_owner(nodes, node)? else {
        return if node.kind == TreeNodeKind::Op {
            op_words(nodes, node).map(Some)
        } else {
            route_words(nodes, node).map(Some)
        };
    };

    Ok(singular_words(singular_owner, schemas).map(|noun| Words {
        verb: split_name(&node.name),
        noun,
    }))
}

// An op reading several records: the single's name, or the collection's plural (`getTasksBatch`
// for a batch).
fn op_words<'raw>(nodes: &TreeNodes<'raw>, op: &TreeNode<'raw>) -> Result<Words, InternalError> {
    let Some(owner) = tree_nodes_op_owner(nodes, op)? else {
        return Ok(Words {
            verb: split_name(&op.name),
            noun: Vec::new(),
        });
    };
    let mut noun = split_name(&owner.name);

    if op.name == "batch" && owner.kind == TreeNodeKind::Collection {
        noun.push(BATCH_SUFFIX.to_owned());

        return Ok(Words {
            verb: vec![BATCH_VERB.to_owned()],
            noun,
        });
    }

    Ok(Words {
        verb: split_name(&op.name),
        noun,
    })
}

// A route off the member scope: the single's name, the collection's plural, or none under a
// surface root.
fn route_words<'raw>(
    nodes: &TreeNodes<'raw>,
    route: &TreeNode<'raw>,
) -> Result<Words, InternalError> {
    let verb = split_name(&route.name);
    let parent = route.parent.map(|id| nodes.get(id)).transpose()?;

    let Some(parent) = parent else {
        return Ok(Words {
            verb,
            noun: Vec::new(),
        });
    };

    if parent.kind == TreeNodeKind::Single {
        return Ok(Words {
            verb,
            noun: split_name(&parent.name),
        });
    }

    let collection = match (parent.kind, parent.parent) {
        (TreeNodeKind::Scope, Some(collection_id)) => Some(nodes.get(collection_id)?),
        _ => None,
    };

    Ok(Words {
        verb,
        noun: collection.map_or_else(Vec::new, |found| split_name(&found.name)),
    })
}

// What `String(value)` writes for a resolved convention, for a message about a broken invariant.
fn written_text(value: &JsonValue) -> String {
    match value {
        JsonValue::Null => "null".to_owned(),
        JsonValue::Bool(flag) => flag.to_string(),
        JsonValue::Number(number) => FiniteNumber::new(number.to_f64())
            .map_or_else(|| number.to_f64().to_string(), |finite| finite.to_string()),
        JsonValue::String(text) => text.clone(),
        JsonValue::Array(items) => items
            .iter()
            .map(|item| match item {
                JsonValue::Null => String::new(),
                other => written_text(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        JsonValue::Object(_) => "[object Object]".to_owned(),
    }
}

fn convention_text(
    conventions: ResolvedConventions<'_>,
    path: &str,
) -> Result<Option<String>, InternalError> {
    Ok(conventions
        .get(path)?
        .map(|reading| written_text(reading.value)))
}

fn id_order(conventions: ResolvedConventions<'_>) -> Result<IdOrder, InternalError> {
    let order = convention_text(conventions, "operationIds.order")?;

    match order.as_deref() {
        Some("verbNoun") => Ok(IdOrder::VerbNoun),
        Some("nounVerb") => Ok(IdOrder::NounVerb),
        other => Err(InternalError::new(format!(
            "conventions.operationIds.order resolves to {}, no order the grammar admits",
            other.unwrap_or("undefined")
        ))),
    }
}

fn id_case(conventions: ResolvedConventions<'_>) -> Result<OperationIdCase, InternalError> {
    let written = convention_text(conventions, "operationIds.case")?;

    match written.as_deref() {
        Some("camel") => Ok(OperationIdCase::Camel),
        Some("snake") => Ok(OperationIdCase::Snake),
        other => Err(InternalError::new(format!(
            "conventions.operationIds.case resolves to {}, no case the grammar admits",
            other.unwrap_or("undefined")
        ))),
    }
}

fn naming_fault(error: &NamingError) -> InternalError {
    InternalError::new(error.to_string())
}

/// The id and name of one operation node.
///
/// `None` when its noun is the singular of a collection that declares neither `singular` nor `id`
/// (the pass reports it).
///
/// # Errors
///
/// An [`InternalError`] for a convention outside the grammar, a node of another list, or a name
/// with no segment.
pub fn tree_nodes_operation_name<'raw>(
    nodes: &TreeNodes<'raw>,
    node: &TreeNode<'raw>,
    conventions: ResolvedConventions<'_>,
    schemas: TreeNodesRawSchemas<'_>,
) -> Result<Option<TreeNodesOperationName>, InternalError> {
    if let Some(written) = tree_nodes_text(node, "operationId") {
        return named(node, written.to_owned(), split_name(written)).map(Some);
    }

    if node.kind == TreeNodeKind::Relay {
        return named(node, node.name.clone(), split_name(&node.name)).map(Some);
    }

    let Some(Words { verb, noun }) = words_of(nodes, node, schemas)? else {
        return Ok(None);
    };
    let segments = match id_order(conventions)? {
        IdOrder::NounVerb => [noun, verb].concat(),
        IdOrder::VerbNoun => [verb, noun].concat(),
    };
    let id =
        operation_id(&segments, id_case(conventions)?).map_err(|error| naming_fault(&error))?;

    named(node, id, segments).map(Some)
}

// The authoring grammar spells node names and operation ids with a leading letter, so each gives
// a segment.
fn named(
    node: &TreeNode<'_>,
    id: String,
    segments: Vec<String>,
) -> Result<TreeNodesOperationName, InternalError> {
    if segments.is_empty() {
        return Err(InternalError::new(format!(
            "the operation at {} has a name with no segment, which the grammar refuses",
            node.pointer
        )));
    }

    Ok(TreeNodesOperationName {
        id,
        name: Name {
            segments,
            role: NameRole::Operation,
            status: None,
        },
    })
}

/// The id and the name of every operation of the api, keyed by the JSON Pointer of its node in the
/// merged raw tree: the route, the relay route, or the `ops` entry (`.../tasks/ops/get` in a
/// mapping, `.../tasks/ops/1` in a list).
///
/// Pure: it reads the raw tree and the conventions only, so `tree.schemas` names inline route
/// schemas with it before `tree.nodes` runs (ADR 0007 section 3). An operation whose collection
/// gives no singular for its name, or that sits in the member scope of a collection without `id`,
/// is left out; `tree.nodes` reports it. The ids are not yet checked unique: `tree.nodes` reports
/// a clash, after `tree.schemas`.
///
/// # Errors
///
/// An [`InternalError`] for a convention outside the grammar or a broken tree.
pub fn tree_nodes_operation_names(
    raw: &RawApi,
    conventions: ResolvedConventions<'_>,
) -> Result<IndexMap<String, TreeNodesOperationName>, InternalError> {
    let nodes = pipeline_tree_nodes(raw)?;
    let schemas = raw.merged.get("schemas");
    let mut names = IndexMap::new();

    for (_, node) in nodes.iter() {
        if !tree_nodes_is_operation(node) || tree_nodes_idless_collection(&nodes, node)?.is_some() {
            continue;
        }

        if let Some(name) = tree_nodes_operation_name(&nodes, node, conventions, schemas)? {
            names.insert(node.pointer.clone(), name);
        }
    }

    Ok(names)
}
