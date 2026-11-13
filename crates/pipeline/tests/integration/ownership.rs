//! Which half writes which draft field: the output types and their `merge_into`.

use seampact_ir::{ApiWire, IrMap, Origin, Param, Response, ResponseHeader};
use seampact_pipeline::{
    AccessIdentityOperation, AccessIdentityOutput, AccessRightsOperation, AccessRightsOutput,
    ApiDeclaration, DeriveErrorsOutput, DeriveWireOperation, DeriveWireOutput, DraftApi, DraftIr,
    DraftOperation, ProofOnlyInput, ResponseHeaderAdditions, SortKeyRights, TreeNodesOutput,
    TreeSchemasMembers,
};
use serde::de::DeserializeOwned;
use serde_json::json;

type Outcome = Result<(), String>;

fn decode<T: DeserializeOwned>(value: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|failure| failure.to_string())
}

fn origin() -> serde_json::Value {
    json!({"layer": "api", "pointer": "/x"})
}

fn schema_ref(schema: &str) -> serde_json::Value {
    json!({"kind": "ref", "schema": schema})
}

fn param(name: &str) -> Result<Param, String> {
    decode(json!({"name": name, "type": schema_ref("S"), "required": true, "origin": origin()}))
}

fn response(status: u16) -> Result<Response, String> {
    decode(json!({"status": status, "shape": "item", "headers": [], "origin": origin()}))
}

fn header(name: &str) -> Result<ResponseHeader, String> {
    decode(json!({"name": name, "type": schema_ref("S"), "required": false}))
}

fn api() -> Result<DraftApi, String> {
    decode(json!({
        "id": "tasks",
        "name": {"segments": ["tasks"], "role": "schema"},
        "version": {"kind": "label", "label": "1"},
        "kind": "product",
        "pathVersion": {"value": "none", "origin": origin()},
        "maturity": "stable",
        "compat": {"policy": "additive-only"},
        "surfaces": {}, "documents": {}, "docs": {}, "extensions": {},
        "origin": origin()
    }))
}

fn api_wire() -> Result<ApiWire, String> {
    decode(json!({"int64": "string", "outputEnums": "enum", "urls": "relative"}))
}

fn operation(extra: serde_json::Value) -> Result<DraftOperation, String> {
    let mut base = json!({
        "id": "getTask",
        "params": {"path": [], "query": [], "header": []},
        "responses": []
    });

    if let (Some(base), serde_json::Value::Object(extra)) = (base.as_object_mut(), extra) {
        base.extend(extra);
    }

    decode(base)
}

fn draft_with(operations: Vec<DraftOperation>) -> Result<DraftIr, String> {
    let mut draft = DraftIr::new();

    draft.api = Some(api()?);
    draft.operations = operations;

    Ok(draft)
}

fn failure_of(result: Result<(), seampact_diagnostics::InternalError>) -> Result<String, String> {
    match result {
        Ok(()) => Err("the merge was accepted".to_owned()),
        Err(failure) => Ok(failure.what().to_owned()),
    }
}

fn derive_wire_output(operations: Vec<DeriveWireOperation>) -> Result<DeriveWireOutput, String> {
    Ok(DeriveWireOutput {
        api_wire: api_wire()?,
        operations,
    })
}

#[test]
fn only_derive_wire_writes_api_wire() -> Outcome {
    let mut draft = draft_with(Vec::new())?;
    let source = api()?;
    let declaration = ApiDeclaration {
        id: source.id,
        name: source.name,
        version: source.version,
        kind: source.kind,
        path_version: source.path_version,
        role: source.role,
        maturity: source.maturity,
        caller: source.caller,
        compat: source.compat,
        surfaces: source.surfaces,
        documents: source.documents,
        docs: source.docs,
        extensions: source.extensions,
        origin: source.origin,
    };

    assert!(
        DraftApi::from(declaration).wire.is_none(),
        "tree.nodes' api type has no wire"
    );

    derive_wire_output(Vec::new())?
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;
    assert_eq!(
        draft.api.as_ref().and_then(|api| api.wire.clone()),
        Some(api_wire()?)
    );

    let again = failure_of(derive_wire_output(Vec::new())?.merge_into(&mut draft))?;

    assert!(
        again.contains("api.wire (derive.wire) is already set"),
        "{again}"
    );

    Ok(())
}

#[test]
fn derive_wire_needs_the_api_tree_nodes_writes() -> Outcome {
    let mut draft = DraftIr::new();
    let failure = failure_of(derive_wire_output(Vec::new())?.merge_into(&mut draft))?;

    assert!(
        failure.contains("api") && failure.contains("no earlier half wrote it"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn a_catalogue_has_one_owner_that_writes_it_once() -> Outcome {
    let mut draft = DraftIr::new();
    let members = || TreeSchemasMembers::default();

    members()
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let schema = decode(json!({
        "kind": "object", "id": "S", "name": {"segments": ["s"], "role": "schema"},
        "properties": [], "directions": ["input"], "examples": [], "docs": {}, "extensions": {},
        "origin": origin()
    }))?;
    let mut written = TreeSchemasMembers::default();

    written.schemas.insert(decode(json!("S"))?, schema);
    written
        .clone()
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let failure = failure_of(written.merge_into(&mut draft))?;

    assert!(
        failure.contains("schemas") && failure.contains("tree.schemas"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn a_default_field_is_written_by_the_first_half_that_has_a_value() -> Outcome {
    let maturity = json!({"level": "stable", "source": "api", "origin": origin()});
    let stated = operation(json!({"maturity": maturity.clone()}))?;
    let mut draft = draft_with(vec![stated, operation(json!({"id": "listTasks"}))?])?;
    let both = DeriveWireOperation {
        maturity: Some(decode(maturity.clone())?),
        ..DeriveWireOperation::default()
    };
    let failure = failure_of(
        derive_wire_output(vec![both.clone(), DeriveWireOperation::default()])?
            .merge_into(&mut draft),
    )?;

    assert!(
        failure.contains("maturity of operation getTask"),
        "{failure}"
    );

    // Operation getTask stated a maturity and derive.wire has none for it: nothing is refused.
    let mut draft = draft_with(vec![
        operation(json!({"maturity": maturity.clone()}))?,
        operation(json!({"id": "listTasks"}))?,
    ])?;

    derive_wire_output(vec![DeriveWireOperation::default(), both])?
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    assert!(
        draft
            .operations
            .iter()
            .all(|operation| operation.maturity.is_some())
    );

    Ok(())
}

fn input_json(unknown_keys: bool) -> serde_json::Value {
    let mut schema = schema_ref("S");

    if unknown_keys && let Some(schema) = schema.as_object_mut() {
        schema.insert("unknownKeys".to_owned(), json!({"policy": "refuse"}));
    }

    json!({"media": "application/json", "schema": schema, "origin": origin()})
}

fn unknown_keys() -> Result<seampact_ir::UnknownKeys, String> {
    decode(json!({"policy": "refuse"}))
}

#[test]
fn each_half_of_the_unknown_keys_default_writes_the_input_schema_row() -> Outcome {
    // access.identity writes it on a declared input; derive.wire then finds it set.
    let mut draft = draft_with(vec![operation(json!({"input": input_json(false)}))?])?;
    let identity = AccessIdentityOutput {
        schemes: IrMap::default(),
        headers: IrMap::default(),
        identities: IrMap::default(),
        operations: vec![AccessIdentityOperation {
            access: decode(json!({"kind": "public", "reason": "r", "origin": origin()}))?,
            caller_kinds: Vec::new(),
            principal_requires: Vec::new(),
            bindings: Vec::new(),
            csrf: None,
            raw_body: Some(true),
            unknown_keys: Some(unknown_keys()?),
        }],
    };

    identity
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let wire = DeriveWireOperation {
        unknown_keys: Some(unknown_keys()?),
        ..DeriveWireOperation::default()
    };
    let failure = failure_of(derive_wire_output(vec![wire.clone()])?.merge_into(&mut draft))?;

    assert!(
        failure
            .contains("input.schema.unknownKeys of operation getTask (derive.wire) is already set"),
        "{failure}"
    );

    // access.rights writes it with the proof-only input; derive.wire then finds it set.
    let mut draft = draft_with(vec![operation(json!({}))?])?;
    let proof_only = ProofOnlyInput {
        media: decode(json!("application/json"))?,
        schema: decode({
            let mut schema = schema_ref("ApiEmptyBody");

            if let Some(schema) = schema.as_object_mut() {
                schema.insert("unknownKeys".to_owned(), json!({"policy": "refuse"}));
            }

            schema
        })?,
        raw_body: true,
        proofs: Vec::new(),
        origin: decode(origin())?,
    };
    let rights = AccessRightsOutput {
        rights: IrMap::default(),
        rules: IrMap::default(),
        scopes: IrMap::default(),
        buckets: IrMap::default(),
        operations: vec![AccessRightsOperation {
            proof_only_input: Some(proof_only),
            ..AccessRightsOperation::default()
        }],
    };

    rights
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let mut by_wire = draft.clone();
    let failure = failure_of(derive_wire_output(vec![wire])?.merge_into(&mut by_wire))?;

    assert!(
        failure
            .contains("input.schema.unknownKeys of operation getTask (derive.wire) is already set"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn derive_wire_fills_unknown_keys_where_no_half_set_them() -> Outcome {
    let mut draft = draft_with(vec![operation(json!({"input": input_json(false)}))?])?;
    let wire = DeriveWireOperation {
        unknown_keys: Some(unknown_keys()?),
        ..DeriveWireOperation::default()
    };

    derive_wire_output(vec![wire])?
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let value = serde_json::to_value(&draft.operations).map_err(|failure| failure.to_string())?;

    assert_eq!(
        value[0]["input"]["schema"]["unknownKeys"],
        json!({"policy": "refuse"})
    );

    Ok(())
}

#[test]
fn raw_body_has_a_declared_input_to_land_on() -> Outcome {
    let mut draft = draft_with(vec![operation(json!({}))?])?;
    let identity = AccessIdentityOutput {
        schemes: IrMap::default(),
        headers: IrMap::default(),
        identities: IrMap::default(),
        operations: vec![AccessIdentityOperation {
            access: decode(json!({"kind": "public", "reason": "r", "origin": origin()}))?,
            caller_kinds: Vec::new(),
            principal_requires: Vec::new(),
            bindings: Vec::new(),
            csrf: None,
            raw_body: Some(false),
            unknown_keys: None,
        }],
    };
    let failure = failure_of(identity.merge_into(&mut draft))?;

    assert!(
        failure.contains("input of operation getTask")
            && failure.contains("no earlier half wrote it"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn lists_concatenate_in_run_order_and_headers_address_either_kind_of_response() -> Outcome {
    let mut declared = operation(json!({}))?;

    declared
        .params
        .as_mut()
        .ok_or("params")?
        .header
        .push(param("declared")?);
    declared
        .responses
        .as_mut()
        .ok_or("responses")?
        .push(response(200)?);

    let mut draft = draft_with(vec![declared])?;
    let rights = AccessRightsOutput {
        rights: IrMap::default(),
        rules: IrMap::default(),
        scopes: IrMap::default(),
        buckets: IrMap::default(),
        operations: vec![AccessRightsOperation {
            header_params: vec![param("proof")?],
            ..AccessRightsOperation::default()
        }],
    };

    rights
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let wire = DeriveWireOperation {
        header_params: vec![param("derived")?],
        responses: vec![response(404)?],
        response_headers: vec![
            ResponseHeaderAdditions {
                response: 0,
                headers: vec![header("A")?],
            },
            ResponseHeaderAdditions {
                response: 1,
                headers: vec![header("B")?],
            },
        ],
        ..DeriveWireOperation::default()
    };

    derive_wire_output(vec![wire])?
        .merge_into(&mut draft)
        .map_err(|failure| failure.to_string())?;

    let operation = draft.operations.first().ok_or("an operation")?;
    let names: Vec<&str> = operation
        .params
        .iter()
        .flat_map(|params| params.header.iter())
        .map(|param| param.name.as_str())
        .collect();
    let statuses_and_headers: Vec<(i64, usize)> = operation
        .responses
        .iter()
        .flatten()
        .map(|response| (response.status, response.headers.len()))
        .collect();

    assert_eq!(names, ["declared", "proof", "derived"]);
    assert_eq!(statuses_and_headers, [(200, 1), (404, 1)]);

    Ok(())
}

#[test]
fn a_response_index_past_both_lists_is_an_internal_error() -> Outcome {
    let mut declared = operation(json!({}))?;

    declared
        .responses
        .as_mut()
        .ok_or("responses")?
        .push(response(200)?);

    let mut draft = draft_with(vec![declared])?;
    let wire = DeriveWireOperation {
        responses: vec![response(404)?],
        response_headers: vec![ResponseHeaderAdditions {
            response: 2,
            headers: vec![header("A")?],
        }],
        ..DeriveWireOperation::default()
    };
    let failure = failure_of(derive_wire_output(vec![wire])?.merge_into(&mut draft))?;

    assert!(
        failure.contains("response index 2 is past the 2 responses"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn a_per_operation_output_of_another_length_is_an_internal_error() -> Outcome {
    let two = || {
        draft_with(vec![
            operation(json!({}))?,
            operation(json!({"id": "other"}))?,
        ])
    };
    let one_wire = derive_wire_output(vec![DeriveWireOperation::default()])?;
    let one_errors = DeriveErrorsOutput {
        errors: IrMap::default(),
        natures: IrMap::default(),
        operation_errors: vec![Vec::new()],
    };
    let one_rights = AccessRightsOutput {
        rights: IrMap::default(),
        rules: IrMap::default(),
        scopes: IrMap::default(),
        buckets: IrMap::default(),
        operations: vec![AccessRightsOperation::default()],
    };

    for failure in [
        failure_of(one_wire.merge_into(&mut two()?))?,
        failure_of(one_errors.merge_into(&mut two()?))?,
        failure_of(one_rights.merge_into(&mut two()?))?,
    ] {
        assert!(
            failure.contains("1 per-operation entries for 2 operations"),
            "{failure}"
        );
    }

    Ok(())
}

#[test]
fn sort_key_rights_match_the_declared_sort_keys() -> Outcome {
    let mut draft = draft_with(vec![operation(json!({}))?])?;
    let rights = |sort_keys: Vec<SortKeyRights>| AccessRightsOutput {
        rights: IrMap::default(),
        rules: IrMap::default(),
        scopes: IrMap::default(),
        buckets: IrMap::default(),
        operations: vec![AccessRightsOperation {
            sort_keys,
            ..AccessRightsOperation::default()
        }],
    };
    let failure = failure_of(rights(vec![SortKeyRights::default()]).merge_into(&mut draft))?;

    assert!(
        failure.contains("1 sort key entries for 0 declared sort keys"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn a_second_write_of_an_owned_member_names_the_member_and_the_operation() -> Outcome {
    let mut draft = draft_with(vec![operation(json!({"errors": []}))?])?;
    let errors = DeriveErrorsOutput {
        errors: IrMap::default(),
        natures: IrMap::default(),
        operation_errors: vec![Vec::new()],
    };
    let failure = failure_of(errors.merge_into(&mut draft))?;

    assert!(
        failure.contains("errors of operation getTask (derive.errors) is already set"),
        "{failure}"
    );

    Ok(())
}

#[test]
fn the_draft_and_every_output_are_send_and_sync() {
    fn assert_send_and_sync<T: Send + Sync>() {}

    assert_send_and_sync::<DraftIr>();
    assert_send_and_sync::<TreeSchemasMembers>();
    assert_send_and_sync::<seampact_pipeline::TreeSchemasOutput>();
    assert_send_and_sync::<TreeNodesOutput>();
    assert_send_and_sync::<AccessIdentityOutput>();
    assert_send_and_sync::<AccessRightsOutput>();
    assert_send_and_sync::<DeriveWireOutput>();
    assert_send_and_sync::<DeriveErrorsOutput>();
    assert_send_and_sync::<Origin>();
}
