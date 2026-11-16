//! Tests of the functions that read the context: the member ids, the scope order and the input
//! policy, on a fake half context.

use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{
    Docs, Extensions, FieldRestriction, InputPolicy, IrMap, Layer, Origin, RefTypeUse, SchemaId,
    Scope, ScopeId, TypeUse,
};
use seampact_json::JsonValue;
use seampact_pipeline::testing::{FakeSchemaService, HalfFixture};
use seampact_pipeline::{
    AccessRightsOutput, DraftIr, InheritedEntry, TreeNodeId, TreeNodeKind, pipeline_tree_nodes,
};

use crate::catalogues::{AccessRightsCatalogues, AccessRightsDeclared, report_within_cycle};
use crate::field_rights::input_policy_of;
use crate::report::access_rights_reporter;
use crate::schema_use::AccessRightsContext;
use crate::scopes::{ScopeUse, resolution_order};
use crate::subjects::member_ids;

fn with_context<R>(
    text: &str,
    body: impl FnOnce(&mut AccessRightsContext<'_, '_, '_>) -> Result<R, InternalError>,
) -> Result<R, InternalError> {
    let mut fixture = HalfFixture::from_json(text)?;
    let draft = DraftIr::new();
    let schemas = FakeSchemaService::new();

    fixture.with_context(|half| {
        let nodes = pipeline_tree_nodes(half.raw)?;
        let mut context = AccessRightsContext {
            draft: &draft,
            context: half,
            schemas: &schemas,
            nodes,
            output: AccessRightsOutput {
                rights: IrMap::new(),
                rules: IrMap::new(),
                scopes: IrMap::new(),
                buckets: IrMap::new(),
                operations: Vec::new(),
            },
        };

        body(&mut context)
    })?
}

fn first_node_of(
    context: &AccessRightsContext<'_, '_, '_>,
    kind: TreeNodeKind,
) -> Result<TreeNodeId, InternalError> {
    context
        .nodes
        .iter()
        .find(|(_, node)| node.kind == kind)
        .map(|(id, _)| id)
        .ok_or_else(|| InternalError::new(format!("no {kind:?} node in the fixture")))
}

const TASKS: &str = r#"{"surfaces":{"app":{"routes":{"tasks":{"kind":"collection","id":{"b":"BId","10":"TenId","2":"TwoId","a/b":"SlashId"},"ops":["get"]}}}}}"#;

#[test]
fn member_ids_follow_the_order_javascript_lists_object_keys() -> Result<(), InternalError> {
    let ids = with_context(TASKS, |context| {
        let op = first_node_of(context, TreeNodeKind::Op)?;

        member_ids(&context.nodes, op)
    })?;
    let names: Vec<&str> = ids.iter().map(|id| id.name.as_str()).collect();

    assert_eq!(names, ["2", "10", "b", "a/b"]);
    assert_eq!(
        ids.last().map(|id| id.pointer.as_str()),
        Some("/surfaces/app/routes/tasks/id/a~1b")
    );

    Ok(())
}

fn scope_declaration(id: &str, within: Option<&str>) -> Scope {
    Scope {
        id: ScopeId::new(id.to_owned()),
        id_schema: TypeUse::Ref(RefTypeUse {
            schema: SchemaId::new("Id".to_owned()),
            unknown_keys: None,
            nullable: None,
            docs: None,
            examples: None,
        }),
        within: within.map(|parent| ScopeId::new(parent.to_owned())),
        errors: Vec::new(),
        docs: Docs::default(),
        extensions: Extensions::default(),
        origin: Origin {
            api: None,
            layer: Layer::Api,
            pointer: format!("/scopes/{id}"),
        },
    }
}

fn catalogues_of(scopes: &[Scope]) -> AccessRightsCatalogues {
    let mut catalogue = IrMap::new();

    for scope in scopes {
        catalogue.insert(scope.id.clone(), scope.clone());
    }

    AccessRightsCatalogues {
        rights: IrMap::new(),
        rules: IrMap::new(),
        scopes: catalogue,
        buckets: IrMap::new(),
        right_id_names: HashMap::default(),
        declared: AccessRightsDeclared::default(),
        forbidden_code: "forbidden".to_owned(),
        right_pattern: None,
    }
}

#[test]
fn scopes_of_one_node_sort_by_utf16_unit_with_a_parent_before_its_child()
-> Result<(), InternalError> {
    // U+1F600 is the surrogate pair D83D DE00, so it sorts before U+E000 in UTF-16.
    let astral = "\u{1F600}";
    let private_use = "\u{E000}";
    let catalogues = catalogues_of(&[
        scope_declaration(astral, None),
        scope_declaration(private_use, None),
        scope_declaration("a", Some("b")),
        scope_declaration("b", None),
    ]);
    let value = JsonValue::String("principal.id".to_owned());
    let ordered = with_context(TASKS, |context| {
        let node = first_node_of(context, TreeNodeKind::Op)?;
        let group: Vec<ScopeUse<'_>> = [private_use, "b", astral, "a"]
            .iter()
            .map(|name| ScopeUse {
                scope: (*name).to_owned(),
                entry: InheritedEntry {
                    value: &value,
                    key: Some((*name).to_owned()),
                    origin: Origin {
                        api: None,
                        layer: Layer::Api,
                        pointer: String::new(),
                    },
                    node,
                },
                pointer: String::new(),
            })
            .collect();

        Ok(resolution_order(group, &catalogues)
            .into_iter()
            .map(|used| used.scope)
            .collect::<Vec<String>>())
    })?;

    // Sorted: a, b, astral, U+E000; `a` is within `b`, so `b` moves ahead of it.
    assert_eq!(ordered, ["b", "a", astral, private_use]);

    Ok(())
}

#[test]
fn an_empty_within_cycle_is_an_internal_error() {
    let mut reporter = access_rights_reporter();

    assert!(report_within_cycle(&mut reporter, &[]).is_err());
    assert_eq!(reporter.errors(), 0);
}

#[test]
fn a_within_cycle_is_one_error_whatever_scope_reached_it() -> Result<(), InternalError> {
    let mut reporter = access_rights_reporter();
    let cycle = ["b".to_owned(), "a".to_owned()];

    report_within_cycle(&mut reporter, &cycle)?;

    assert_eq!(reporter.errors(), 1);

    Ok(())
}

fn restriction(policy: Option<InputPolicy>) -> FieldRestriction {
    FieldRestriction {
        right: seampact_ir::RightId::new("tasks.read".to_owned()),
        params: None,
        input_policy: policy,
        origin: None,
    }
}

#[test]
fn the_input_policy_is_the_fields_own_else_the_convention_else_reject() -> Result<(), InternalError>
{
    let own = with_context("{}", |context| {
        input_policy_of(context, &restriction(Some(InputPolicy::Strip)))
    })?;
    let default = with_context("{}", |context| input_policy_of(context, &restriction(None)))?;
    let written = with_context(
        r#"{"conventions":{"restrictedInput":"strip"}}"#,
        |context| input_policy_of(context, &restriction(None)),
    )?;

    assert_eq!(own, InputPolicy::Strip);
    assert_eq!(default, InputPolicy::Reject);
    assert_eq!(written, InputPolicy::Strip);

    Ok(())
}

#[test]
fn a_convention_that_names_no_policy_is_an_internal_error() {
    let refused = with_context(
        r#"{"conventions":{"restrictedInput":"allow"}}"#,
        |context| input_policy_of(context, &restriction(None)),
    );

    let message = refused.map_err(|error| error.to_string());

    assert!(
        message
            .as_ref()
            .is_err_and(|text| text
                .contains("conventions.restrictedInput resolves to no policy: \"allow\"")),
        "got {message:?}"
    );
}
