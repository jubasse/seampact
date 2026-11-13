//! The tree-node model and the inherited settings, over an api with every node kind.

use seampact_json::JsonValue;
use seampact_pipeline::{
    Inherited, InheritedEntry, NearestSetting, OrderedSetting, PerKeySetting, TreeNodeId,
    UnionSetting,
};

use super::raw_api::{api_origin, single_layer_api};

const API: &str = r#"{
  "surfaces": {"app": {
    "prefix": "/v{version}", "identity": "user", "tags": ["app"], "requires": ["r1"],
    "errorRoles": {"notFound": "a.missing", "forbidden": "a.denied"},
    "errors": {"app.gone": {"reach": "resource"}},
    "routes": {
      "tasks": {
        "kind": "collection", "id": {"taskId": "TaskId"}, "tags": ["app", "tasks"],
        "errors": {"app.gone": {"reach": "resource"}, "tasks.locked": {}},
        "requires": ["r2"],
        "ops": {"list": {}, "get": {"identity": "admin", "tags": ["read"]}},
        "member": {
          "scopes": {"task": "path.taskId"},
          "errorRoles": {"notFound": "a.noTask"},
          "routes": {"assign": {"method": "post", "requires": ["r3"], "scopes": {"project": "path.projectId"}}}
        }
      },
      "labels": {"kind": "collection", "id": {"labelId": "LabelId"}, "ops": ["get", "list"]},
      "me": {"kind": "single", "ops": ["get"], "routes": {"avatar": {"method": "get"}}},
      "hook": {"relays": "b.getTask"}
    }
  }}
}"#;

const TASKS: &str = "/surfaces/app/routes/tasks";
const LABELS: &str = "/surfaces/app/routes/labels";

fn node_at(inherited: &Inherited<'_>, pointer: &str) -> TreeNodeId {
    inherited
        .nodes()
        .iter()
        .find(|(_, node)| node.pointer == pointer)
        .map_or_else(|| panic!("no node at {pointer}"), |(id, _)| id)
}

fn pointers(entries: &[InheritedEntry<'_>]) -> Vec<String> {
    entries
        .iter()
        .map(|entry| entry.origin.pointer.clone())
        .collect()
}

fn text(value: &JsonValue) -> String {
    match value {
        JsonValue::String(text) => text.clone(),
        other => format!("{other:?}"),
    }
}

#[test]
fn tree_nodes_in_document_order_with_op_entries_under_their_scope() {
    let raw = single_layer_api(API);
    let inherited = Inherited::new(&raw).unwrap();
    let nodes = inherited.nodes();
    let listed: Vec<(String, String, String, Option<String>)> = nodes
        .iter()
        .map(|(_, node)| {
            let parent = node.parent.map(|id| nodes.get(id).unwrap().pointer.clone());

            (
                node.kind.as_str().to_owned(),
                node.name.clone(),
                node.pointer.clone(),
                parent,
            )
        })
        .collect();
    let row = |kind: &str, name: &str, pointer: String, parent: Option<&str>| {
        (
            kind.to_owned(),
            name.to_owned(),
            pointer,
            parent.map(str::to_owned),
        )
    };

    assert_eq!(
        listed,
        vec![
            row("surface", "app", "/surfaces/app".into(), None),
            row("collection", "tasks", TASKS.into(), Some("/surfaces/app")),
            row(
                "scope",
                "collection",
                format!("{TASKS}/collection"),
                Some(TASKS)
            ),
            row(
                "op",
                "list",
                format!("{TASKS}/ops/list"),
                Some(&format!("{TASKS}/collection"))
            ),
            row("scope", "member", format!("{TASKS}/member"), Some(TASKS)),
            row(
                "op",
                "get",
                format!("{TASKS}/ops/get"),
                Some(&format!("{TASKS}/member"))
            ),
            row(
                "route",
                "assign",
                format!("{TASKS}/member/routes/assign"),
                Some(&format!("{TASKS}/member"))
            ),
            row("collection", "labels", LABELS.into(), Some("/surfaces/app")),
            row(
                "scope",
                "collection",
                format!("{LABELS}/collection"),
                Some(LABELS)
            ),
            row(
                "op",
                "list",
                format!("{LABELS}/ops/1"),
                Some(&format!("{LABELS}/collection"))
            ),
            row("scope", "member", format!("{LABELS}/member"), Some(LABELS)),
            row(
                "op",
                "get",
                format!("{LABELS}/ops/0"),
                Some(&format!("{LABELS}/member"))
            ),
            row(
                "single",
                "me",
                "/surfaces/app/routes/me".into(),
                Some("/surfaces/app")
            ),
            row(
                "op",
                "get",
                "/surfaces/app/routes/me/ops/0".into(),
                Some("/surfaces/app/routes/me")
            ),
            row(
                "route",
                "avatar",
                "/surfaces/app/routes/me/routes/avatar".into(),
                Some("/surfaces/app/routes/me")
            ),
            row(
                "relay",
                "hook",
                "/surfaces/app/routes/hook".into(),
                Some("/surfaces/app")
            ),
        ]
    );

    // A scope not written takes its collection's origin; a written one and an `ops` list entry
    // their own.
    let origin_of = |pointer: &str| {
        nodes
            .get(node_at(&inherited, pointer))
            .unwrap()
            .origin
            .clone()
    };

    assert_eq!(origin_of(&format!("{TASKS}/collection")), api_origin(TASKS));
    assert_eq!(
        origin_of(&format!("{TASKS}/member")),
        api_origin(&format!("{TASKS}/member"))
    );
    assert_eq!(
        origin_of(&format!("{LABELS}/ops/1")),
        api_origin(&format!("{LABELS}/ops/1"))
    );
    assert!(
        nodes
            .get(node_at(&inherited, &format!("{LABELS}/ops/1")))
            .unwrap()
            .settings
            .is_empty()
    );
}

#[test]
fn nearest_takes_the_closest_node_that_sets_the_setting() {
    let raw = single_layer_api(API);
    let inherited = Inherited::new(&raw).unwrap();
    let get = node_at(&inherited, &format!("{TASKS}/ops/get"));
    let list = node_at(&inherited, &format!("{TASKS}/ops/list"));
    let own = inherited
        .nearest(get, &NearestSetting::Identity)
        .unwrap()
        .unwrap();

    assert_eq!(text(own.value), "admin");
    assert_eq!(own.origin, api_origin(&format!("{TASKS}/ops/get/identity")));
    assert_eq!(own.node, get);

    let surface = inherited
        .nearest(list, &NearestSetting::Identity)
        .unwrap()
        .unwrap();

    assert_eq!(surface.origin.pointer, "/surfaces/app/identity");
    assert!(
        inherited
            .nearest(list, &NearestSetting::Csrf)
            .unwrap()
            .is_none()
    );
    assert!(NearestSetting::extension("owner").is_none());
    assert!(NearestSetting::extension("x-owner").is_some());
}

#[test]
fn ordered_keeps_every_entry_from_the_root_down() {
    let raw = single_layer_api(API);
    let inherited = Inherited::new(&raw).unwrap();
    let get = node_at(&inherited, &format!("{TASKS}/ops/get"));
    let list = node_at(&inherited, &format!("{TASKS}/ops/list"));
    let assign = node_at(&inherited, &format!("{TASKS}/member/routes/assign"));

    // A setting on the member scope reaches `get`, not `list`.
    let scopes = inherited
        .ordered(get, OrderedSetting::Scopes)
        .unwrap()
        .unwrap();

    assert_eq!(
        scopes
            .iter()
            .map(|e| (e.key.clone(), text(e.value)))
            .collect::<Vec<_>>(),
        vec![(Some("task".to_owned()), "path.taskId".to_owned())]
    );
    assert!(
        inherited
            .ordered(list, OrderedSetting::Scopes)
            .unwrap()
            .is_none()
    );

    let requires = inherited
        .ordered(assign, OrderedSetting::Requires)
        .unwrap()
        .unwrap();

    assert_eq!(
        requires.iter().map(|e| text(e.value)).collect::<Vec<_>>(),
        ["r1", "r2", "r3"]
    );
    assert_eq!(
        pointers(&requires),
        [
            "/surfaces/app/requires/0".to_owned(),
            format!("{TASKS}/requires/0"),
            format!("{TASKS}/member/routes/assign/requires/0"),
        ]
    );

    let assign_scopes = inherited
        .ordered(assign, OrderedSetting::Scopes)
        .unwrap()
        .unwrap();
    let names = inherited.nodes();

    assert_eq!(
        assign_scopes
            .iter()
            .map(|e| (
                e.key.clone().unwrap(),
                names.get(e.node).unwrap().name.clone()
            ))
            .collect::<Vec<_>>(),
        [
            ("task".to_owned(), "member".to_owned()),
            ("project".to_owned(), "assign".to_owned())
        ]
    );
}

#[test]
fn union_drops_an_equal_entry_and_keeps_the_first_setters_origin() {
    let raw = single_layer_api(API);
    let inherited = Inherited::new(&raw).unwrap();
    let get = node_at(&inherited, &format!("{TASKS}/ops/get"));
    let tags = inherited.union(get, UnionSetting::Tags).unwrap().unwrap();

    assert_eq!(
        tags.iter().map(|e| text(e.value)).collect::<Vec<_>>(),
        ["app", "tasks", "read"]
    );
    assert_eq!(
        pointers(&tags),
        [
            "/surfaces/app/tags/0".to_owned(),
            format!("{TASKS}/tags/1"),
            format!("{TASKS}/ops/get/tags/0"),
        ]
    );
}

#[test]
fn errors_keep_every_attachment_with_its_node() {
    let raw = single_layer_api(API);
    let inherited = Inherited::new(&raw).unwrap();
    let get = node_at(&inherited, &format!("{TASKS}/ops/get"));
    let errors = inherited.union(get, UnionSetting::Errors).unwrap().unwrap();
    let nodes = inherited.nodes();

    assert_eq!(
        errors
            .iter()
            .map(|e| (
                e.key.clone().unwrap(),
                nodes.get(e.node).unwrap().name.clone(),
                e.origin.pointer.clone()
            ))
            .collect::<Vec<_>>(),
        [
            (
                "app.gone".to_owned(),
                "app".to_owned(),
                "/surfaces/app/errors/app.gone".to_owned()
            ),
            (
                "app.gone".to_owned(),
                "tasks".to_owned(),
                format!("{TASKS}/errors/app.gone")
            ),
            (
                "tasks.locked".to_owned(),
                "tasks".to_owned(),
                format!("{TASKS}/errors/tasks.locked")
            ),
        ]
    );
}

#[test]
fn per_key_takes_the_nearest_node_for_each_key_in_first_set_order() {
    let raw = single_layer_api(API);
    let inherited = Inherited::new(&raw).unwrap();
    let assign = node_at(&inherited, &format!("{TASKS}/member/routes/assign"));
    let roles = inherited
        .per_key(assign, PerKeySetting::ErrorRoles)
        .unwrap()
        .unwrap();

    assert_eq!(
        roles
            .iter()
            .map(|(key, e)| (key.clone(), text(e.value), e.origin.pointer.clone()))
            .collect::<Vec<_>>(),
        [
            (
                "notFound".to_owned(),
                "a.noTask".to_owned(),
                format!("{TASKS}/member/errorRoles/notFound")
            ),
            (
                "forbidden".to_owned(),
                "a.denied".to_owned(),
                "/surfaces/app/errorRoles/forbidden".to_owned()
            ),
        ]
    );
}

#[test]
fn a_union_entrys_identity_ignores_key_order() {
    // A hand-made merged tree: the readers are generic over the values, and no union setting of
    // the grammar holds objects yet.
    let raw = single_layer_api(
        r#"{"surfaces":{"app":{
            "tags":[{"a":1,"b":[{"c":1,"d":2}]},"app"],
            "routes":{"ping":{"method":"get","tags":[{"b":[{"d":2,"c":1}],"a":1},"ping"]}}}}}"#,
    );
    let inherited = Inherited::new(&raw).unwrap();
    let ping = node_at(&inherited, "/surfaces/app/routes/ping");
    let tags = inherited.union(ping, UnionSetting::Tags).unwrap().unwrap();
    let nodes = inherited.nodes();

    assert_eq!(
        tags.iter()
            .map(|e| nodes.get(e.node).unwrap().name.clone())
            .collect::<Vec<_>>(),
        ["app", "app", "ping"]
    );
}
