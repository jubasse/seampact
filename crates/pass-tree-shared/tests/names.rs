//! The ported cases of the `tree.nodes` names tests that reach the shared functions only.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use seampact_ir::{Name, NameRole, OpShorthand};
use seampact_pass_tree_shared::{
    TREE_NODES_BATCH_OP, TREE_NODES_DELETE_OP, TREE_NODES_LIST_OP, TreeNodesOperationName,
    tree_nodes_id_param, tree_nodes_idless_collection, tree_nodes_is_operation,
    tree_nodes_op_owner, tree_nodes_op_shorthand, tree_nodes_operation_names,
    tree_nodes_singular_is_bare_id, tree_nodes_singular_owner,
};
use seampact_pipeline::{TreeNodeKind, pipeline_conventions, pipeline_tree_nodes};
use support::api_of;

const CONVENTIONS_NONE: &str = "";

// The tree of the ops-and-ids fixture, under the conventions each row writes.
fn contract(conventions: &str) -> String {
    format!(
        r"
api: {{ name: shop, version: 1, kind: product }}
{conventions}
schemas:
  UserId: {{ type: string }}
  Member:
    type: object
    required: [userId]
    properties:
      userId: UserId
      role: {{ type: string }}
  UpdateMember:
    type: object
    properties:
      role: {{ type: string }}
surfaces:
  app:
    prefix: /v{{version}}
    routes:
      members:
        kind: collection
        id: {{ userId: UserId }}
        singular: member
        item: Member
        ops:
          list: {{ paging: none }}
          get: {{}}
          update: {{ input: UpdateMember }}
          delete: {{ method: post, operationId: removeMember }}
          batch: {{}}
        collection:
          routes:
            search: {{ method: post }}
        member:
          routes:
            promote: {{ method: post }}
      me:
        kind: single
        item: Member
        ops: [get]
        routes:
          avatar: {{ method: get }}
      ping: {{ method: get }}
"
    )
}

const DEFAULT_IDS: [&str; 10] = [
    "listMembers",
    "getMembersBatch",
    "searchMembers",
    "getMember",
    "updateMember",
    "removeMember",
    "promoteMember",
    "getMe",
    "avatarMe",
    "ping",
];

fn operation(segments: &[&str]) -> NameOf {
    NameOf(Name {
        segments: segments.iter().map(|word| (*word).to_owned()).collect(),
        role: NameRole::Operation,
        status: None,
    })
}

struct NameOf(Name);

fn names_of(contract_text: &str) -> indexmap::IndexMap<String, TreeNodesOperationName> {
    let raw = api_of(contract_text);

    tree_nodes_operation_names(&raw, pipeline_conventions(&raw)).expect("the names")
}

fn ids_of(contract_text: &str) -> Vec<String> {
    names_of(contract_text)
        .values()
        .map(|name| name.id.clone())
        .collect()
}

#[test]
fn operation_names_key_every_operation_by_its_route_pointer() {
    let names = names_of(&contract(CONVENTIONS_NONE));
    let batch = names
        .get("/surfaces/app/routes/members/ops/batch")
        .expect("the batch op");

    assert_eq!(batch.id, "getMembersBatch");
    assert_eq!(batch.name, operation(&["get", "members", "batch"]).0);
    assert_eq!(
        names
            .get("/surfaces/app/routes/members/member/routes/promote")
            .map(|name| name.id.as_str()),
        Some("promoteMember")
    );
    assert_eq!(
        names
            .get("/surfaces/app/routes/me/ops/0")
            .map(|name| name.id.as_str()),
        Some("getMe")
    );
    assert_eq!(ids_of(&contract(CONVENTIONS_NONE)), DEFAULT_IDS);
}

#[test]
fn conventions_choose_the_order_and_the_case_of_the_id() {
    let ids = ids_of(&contract(
        "conventions: { operationIds: { order: nounVerb, case: snake } }",
    ));

    assert_eq!(ids.first().map(String::as_str), Some("members_list"));
    assert_eq!(ids.get(1).map(String::as_str), Some("members_batch_get"));
}

#[test]
fn a_relay_route_is_named_by_its_route_name_or_its_operation_id() {
    let names = names_of(
        r"
api: { name: svc, version: 1, kind: service }
surfaces:
  internal:
    prefix: /internal/v{version}
    routes:
      getTask: { relays: tasks.getTask }
      getBillingTask: { relays: billing.getTask, operationId: fetchBillingTask }
",
    );
    let found: Vec<(&str, &Name)> = names
        .values()
        .map(|name| (name.id.as_str(), &name.name))
        .collect();

    assert_eq!(
        found,
        [
            ("getTask", &operation(&["get", "task"]).0),
            (
                "fetchBillingTask",
                &operation(&["fetch", "billing", "task"]).0
            ),
        ]
    );
}

#[test]
fn a_collection_with_neither_singular_nor_id_leaves_its_operations_out() {
    let singulars = r"
api: { name: a, version: 1, kind: product }
pagings:
  cursor:
    request: { cursor: { query: cursor }, limit: { query: limit } }
    response: { body: $items }
conventions:
  paging: { default: cursor, maxLimit: 50 }
schemas:
  Event: { type: object, properties: { eventKey: { type: string } } }
  Log: { type: object, properties: { line: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      events:
        kind: collection
        singular: event
        idProperty: eventKey
        item: Event
        ops: { list: {}, create: { input: Event } }
      logs:
        kind: collection
        item: Log
        ops: [list, create, get]
        member:
          routes:
            tail: { method: get }
";

    assert_eq!(ids_of(singulars), ["listEvents", "createEvent", "listLogs"]);
}

#[test]
fn the_node_readers_follow_the_tree() {
    let raw = api_of(&contract(CONVENTIONS_NONE));
    let nodes = pipeline_tree_nodes(&raw).expect("the nodes");
    let find = |pointer: &str| {
        nodes
            .iter()
            .map(|(_, node)| node)
            .find(|node| node.pointer == pointer)
            .expect("a node")
    };
    let schemas = raw.merged.get("schemas");
    let members = find("/surfaces/app/routes/members");
    let get_op = find("/surfaces/app/routes/members/ops/get");
    let list_op = find("/surfaces/app/routes/members/ops/list");
    let promote = find("/surfaces/app/routes/members/member/routes/promote");
    let ping = find("/surfaces/app/routes/ping");
    let me_get = find("/surfaces/app/routes/me/ops/0");

    assert!(tree_nodes_is_operation(promote) && tree_nodes_is_operation(get_op));
    assert!(!tree_nodes_is_operation(members));
    assert_eq!(members.kind, TreeNodeKind::Collection);

    assert_eq!(tree_nodes_op_shorthand(get_op), Some(OpShorthand::Get));
    assert_eq!(tree_nodes_op_shorthand(promote), None);
    assert_eq!(tree_nodes_op_shorthand(me_get), Some(OpShorthand::Get));
    assert_eq!(
        (
            TREE_NODES_LIST_OP,
            TREE_NODES_DELETE_OP,
            TREE_NODES_BATCH_OP
        ),
        (OpShorthand::List, OpShorthand::Delete, OpShorthand::Batch)
    );

    let owner = tree_nodes_op_owner(&nodes, get_op).expect("an owner");

    assert_eq!(owner.map(|node| node.name.as_str()), Some("members"));
    assert_eq!(
        tree_nodes_op_owner(&nodes, me_get)
            .expect("an owner")
            .map(|node| node.name.as_str()),
        Some("me")
    );
    assert_eq!(
        tree_nodes_singular_owner(&nodes, get_op)
            .expect("a result")
            .map(|node| node.name.as_str()),
        Some("members")
    );
    assert!(
        tree_nodes_singular_owner(&nodes, list_op)
            .expect("a result")
            .is_none()
    );
    assert!(
        tree_nodes_singular_owner(&nodes, ping)
            .expect("a result")
            .is_none()
    );
    assert!(
        tree_nodes_idless_collection(&nodes, promote)
            .expect("a result")
            .is_none()
    );

    assert_eq!(
        tree_nodes_id_param(members, schemas).as_deref(),
        Some("userId")
    );
    assert!(!tree_nodes_singular_is_bare_id(members, schemas));
}

#[test]
fn an_id_schema_name_reads_the_first_property_in_javascript_key_order() {
    let raw = api_of(
        r"
api: { name: a, version: 1, kind: product }
schemas:
  Key: { type: object, properties: { zeta: { type: string }, 7: { type: string } } }
  Bare: { type: object, properties: { id: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      keyed: { kind: collection, id: Key, item: Key, ops: [get] }
      bare: { kind: collection, id: Bare, item: Bare, ops: [get] }
      loose: { kind: collection, id: Missing, item: Bare, ops: [get] }
",
    );
    let nodes = pipeline_tree_nodes(&raw).expect("the nodes");
    let schemas = raw.merged.get("schemas");
    let collection = |name: &str| {
        nodes
            .iter()
            .map(|(_, node)| node)
            .find(|node| node.kind == TreeNodeKind::Collection && node.name == name)
            .expect("a collection")
    };

    // `Object.keys` lists an array-index key before the others.
    assert_eq!(
        tree_nodes_id_param(collection("keyed"), schemas).as_deref(),
        Some("7")
    );
    assert!(tree_nodes_singular_is_bare_id(collection("bare"), schemas));
    assert_eq!(tree_nodes_id_param(collection("loose"), schemas), None);
}

#[test]
fn a_member_scope_of_a_collection_without_id_is_idless() {
    let raw = api_of(
        r"
api: { name: a, version: 1, kind: product }
schemas:
  Log: { type: object, properties: { line: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      logs:
        kind: collection
        item: Log
        ops: [get]
",
    );
    let nodes = pipeline_tree_nodes(&raw).expect("the nodes");
    let get_op = nodes
        .iter()
        .map(|(_, node)| node)
        .find(|node| node.kind == TreeNodeKind::Op)
        .expect("an op");
    let idless = tree_nodes_idless_collection(&nodes, get_op).expect("a result");

    assert_eq!(idless.map(|node| node.name.as_str()), Some("logs"));
}
