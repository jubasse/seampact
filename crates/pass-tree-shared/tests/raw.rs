//! The raw tree readers, the draft schema readers and the relay origin.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::too_many_lines,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_authoring::RawWorkspace;
use seampact_diagnostics::DiagnosticSink;
use seampact_ir::{Direction, Layer, Origin, QueryWire, Schema, SchemaId, TypeUse};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{
    TREE_NODES_MATURITIES, TREE_NODES_OPERATION_KIND, tree_nodes_answered_use,
    tree_nodes_draft_schema, tree_nodes_member, tree_nodes_object_of, tree_nodes_origin_at,
    tree_nodes_relay_origin, tree_nodes_schema, tree_nodes_setting, tree_nodes_tag_header,
    tree_nodes_text, tree_nodes_written_convention,
};
use seampact_pipeline::{
    DraftIr, HalfContext, Inherited, PassError, TreeSchemaExampleIssue, TreeSchemaService,
    pipeline_conventions, pipeline_tree_nodes,
};
use support::api_of;

fn json(text: &str) -> JsonValue {
    serde_json::from_str(text).expect("JSON text")
}

fn origin(layer: Layer, api: Option<&str>, pointer: &str) -> Origin {
    Origin {
        api: api.map(str::to_owned),
        layer,
        pointer: pointer.to_owned(),
    }
}

fn schema_from(text: &str) -> Schema {
    serde_json::from_str(text).expect("a schema")
}

fn named_schema(kind_members: &str, id: &str) -> Schema {
    schema_from(&format!(
        r#"{{"id":"{id}","name":{{"segments":["x"],"role":"schema"}},"directions":["input"],"examples":[],"docs":{{}},"extensions":{{}},"origin":{{"layer":"api","pointer":"/schemas/{id}"}},{kind_members}}}"#
    ))
}

fn draft_with_schemas() -> DraftIr {
    let mut draft = DraftIr::new();
    let schemas = [
        named_schema(r#""kind":"object","properties":[]"#, "Task"),
        named_schema(
            r#""kind":"union","variants":[],"tag":{"in":"header","name":"X-Kind"}"#,
            "ByHeader",
        ),
        named_schema(
            r#""kind":"union","variants":[],"tag":{"in":"body","property":"type"}"#,
            "ByBody",
        ),
    ];

    for schema in schemas {
        let id = match &schema {
            Schema::Object(object) => object.id.clone(),
            Schema::Union(union) => union.id.clone(),
            other => panic!("unexpected schema {other:?}"),
        };

        draft.schemas.insert(id, schema);
    }

    draft
}

fn reference(id: &str) -> TypeUse {
    serde_json::from_str(&format!(r#"{{"kind":"ref","schema":"{id}"}}"#)).expect("a use")
}

#[test]
fn a_member_is_read_from_a_mapping_only() {
    let value = json(r#"{"a":1,"b":{"c":"x"},"d":[1]}"#);

    assert_eq!(tree_nodes_member(Some(&value), "a"), Some(&json("1")));
    assert_eq!(tree_nodes_member(Some(&value), "zz"), None);
    assert_eq!(tree_nodes_member(None, "a"), None);
    assert_eq!(tree_nodes_member(Some(&json("[1]")), "0"), None);
    assert_eq!(tree_nodes_member(Some(&json("null")), "a"), None);
    assert_eq!(tree_nodes_member(Some(&json(r#""text""#)), "length"), None);
    // An own key named like an inherited property is still an own key.
    assert_eq!(
        tree_nodes_member(Some(&json(r#"{"__proto__":2}"#)), "__proto__"),
        Some(&json("2"))
    );
    assert_eq!(tree_nodes_member(Some(&value), "constructor"), None);
}

#[test]
fn a_setting_and_its_text_read_the_node_mapping() {
    let raw = api_of(
        r"
api: { name: a, version: 1, kind: product }
surfaces:
  app:
    prefix: /v{version}
    routes:
      ping: { method: get, operationId: ping1, retries: 3 }
",
    );
    let nodes = pipeline_tree_nodes(&raw).expect("the nodes");
    let ping = nodes
        .iter()
        .map(|(_, node)| node)
        .find(|node| node.name == "ping")
        .expect("ping");

    assert_eq!(tree_nodes_text(ping, "operationId"), Some("ping1"));
    assert_eq!(tree_nodes_text(ping, "retries"), None);
    assert_eq!(tree_nodes_setting(ping, "retries"), Some(&json("3")));
    assert_eq!(tree_nodes_setting(ping, "absent"), None);
}

#[test]
fn the_relay_origin_stamps_the_api_of_a_copied_element_once() {
    let own = origin(Layer::Api, None, "/surfaces/a");
    let copied = origin(Layer::Api, Some("first"), "/surfaces/a");
    let core = origin(Layer::Core, None, "/errors/x");

    assert_eq!(
        tree_nodes_relay_origin(&own, "second"),
        origin(Layer::Api, Some("second"), "/surfaces/a")
    );
    assert_eq!(tree_nodes_relay_origin(&copied, "second"), copied);
    assert_eq!(tree_nodes_relay_origin(&core, "second"), core);
    assert_eq!(TREE_NODES_OPERATION_KIND.as_str(), "httpOperation");
}

#[test]
fn the_maturity_levels_run_least_first() {
    let levels: Vec<&str> = TREE_NODES_MATURITIES
        .iter()
        .map(seampact_ir::Maturity::as_str)
        .collect();

    assert_eq!(levels, ["experimental", "provisional", "stable"]);
}

#[test]
fn the_draft_schema_readers_follow_a_reference() {
    let draft = draft_with_schemas();

    assert!(tree_nodes_schema(&draft, "Task").is_some());
    assert!(tree_nodes_schema(&draft, "constructor").is_none());
    assert!(tree_nodes_draft_schema(&draft, "Task").is_ok());

    let missing = tree_nodes_draft_schema(&draft, "Nope").expect_err("a missing schema");

    assert!(
        missing
            .to_string()
            .contains("the draft holds no schema Nope")
    );

    let task = reference("Task");
    let by_header = reference("ByHeader");
    let by_body = reference("ByBody");
    let scalar: TypeUse =
        serde_json::from_str(r#"{"kind":"scalar","type":"string","refinements":{}}"#)
            .expect("a use");

    assert!(tree_nodes_object_of(&draft, Some(&task)).is_some());
    assert!(tree_nodes_object_of(&draft, Some(&by_header)).is_none());
    assert!(tree_nodes_object_of(&draft, Some(&scalar)).is_none());
    assert!(tree_nodes_object_of(&draft, Some(&reference("Nope"))).is_none());
    assert!(tree_nodes_object_of(&draft, None).is_none());

    assert_eq!(
        tree_nodes_tag_header(&draft, Some(&by_header)),
        Some("X-Kind")
    );
    assert_eq!(tree_nodes_tag_header(&draft, Some(&by_body)), None);
    assert_eq!(tree_nodes_tag_header(&draft, Some(&task)), None);
    assert_eq!(tree_nodes_tag_header(&draft, None), None);
}

#[test]
fn a_convention_is_written_only_at_its_own_leaf() {
    let raw = api_of(
        r"
api: { name: a, version: 1, kind: product }
conventions: { pathCase: kebab }
surfaces:
  app:
    prefix: /v{version}
    routes:
      ping: { method: get }
",
    );
    let conventions = pipeline_conventions(&raw);
    let written = tree_nodes_written_convention(conventions, "pathCase")
        .expect("a leaf")
        .expect("written");

    assert_eq!(written.value, &json(r#""kebab""#));
    assert_eq!(written.origin.pointer, "/conventions/pathCase");
    assert!(
        tree_nodes_written_convention(conventions, "format")
            .expect("a leaf")
            .is_none()
    );
    assert!(tree_nodes_written_convention(conventions, "noSuchLeaf").is_err());
}

#[test]
fn an_origin_falls_back_to_the_nearest_located_pointer_above() {
    let raw = api_of(
        r"
api: { name: a, version: 1, kind: product }
surfaces:
  app:
    prefix: /v{version}
    routes:
      ping: { method: get }
",
    );
    let workspace = RawWorkspace {
        root: Utf8PathBuf::from("."),
        apis: vec![raw.clone()],
        locations: IndexMap::new(),
        entry: None,
        config: None,
    };
    let conventions = pipeline_conventions(&raw);
    let inherited = Inherited::new(&raw).expect("inherited");
    let relayed: IndexMap<String, DraftIr> = IndexMap::new();
    let imports = IndexMap::new();
    let mut sink = DiagnosticSink::new();
    let context = HalfContext::new(
        &raw,
        &workspace,
        &conventions,
        &inherited,
        &relayed,
        &imports,
        &mut sink,
    );
    let located =
        tree_nodes_origin_at(&context, "/surfaces/app/routes/ping/method").expect("located");

    assert_eq!(located.pointer, "/surfaces/app/routes/ping/method");

    let above = tree_nodes_origin_at(&context, "/surfaces/app/routes/ping/method/not/there")
        .expect("located above");

    assert_eq!(above.pointer, "/surfaces/app/routes/ping/method");

    let nothing = tree_nodes_origin_at(&context, "/nowhere/at/all").expect_err("not located");

    assert!(
        nothing
            .to_string()
            .contains("locates nothing at or above /nowhere/at/all")
    );
    assert!(tree_nodes_origin_at(&context, "").is_err());
}

struct StubService {
    answer: Option<TypeUse>,
}

impl TreeSchemaService for StubService {
    fn type_use(
        &self,
        _pointer: &str,
        _direction: Direction,
    ) -> Result<Option<TypeUse>, PassError> {
        Ok(self.answer.clone())
    }

    fn query_wire(&self, _pointer: &str) -> Result<Option<QueryWire>, PassError> {
        Ok(None)
    }

    fn check_example(
        &self,
        _value: &JsonValue,
        _schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Ok(Vec::new())
    }

    fn check_text_example(
        &self,
        _text: &str,
        _schema_use: &TypeUse,
    ) -> Result<Vec<TreeSchemaExampleIssue>, PassError> {
        Ok(Vec::new())
    }
}

#[test]
fn an_answered_use_is_the_services_or_an_internal_error() {
    let answering = StubService {
        answer: Some(reference("Task")),
    };
    let silent = StubService { answer: None };

    assert_eq!(
        tree_nodes_answered_use(&answering, "/p", &Direction::Input).expect("an answer"),
        reference("Task")
    );

    let error = tree_nodes_answered_use(&silent, "/p", &Direction::Input).expect_err("no answer");

    assert!(
        error
            .to_string()
            .contains("the schema service answers no input type at /p")
    );
}

#[test]
fn schema_ids_are_plain_text() {
    assert_eq!(SchemaId::new("Task".to_owned()).as_str(), "Task");
}
