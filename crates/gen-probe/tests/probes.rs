//! The probes answer what their options say, through the generator contract.

use seampact_gen_probe::{PROBE_CLIENT, PROBE_SERVER};
use seampact_ir::ContractIr;
use seampact_json::JsonValue;
use seampact_target::{
    CompatibilityMatrix, GenerateRequest, Generator, Refused, TargetFailure, resolve_link_needs,
};

type TestResult<Value> = Result<Value, Box<dyn std::error::Error>>;

fn reference_ir() -> TestResult<ContractIr> {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/expected/reference/ir/tasks.json"
    ))?;

    Ok(ContractIr::from_json_text(&text)?)
}

fn refused_of(failure: TargetFailure) -> TestResult<Refused> {
    match failure {
        TargetFailure::Refused(refused) => Ok(refused),
        TargetFailure::Internal(error) => Err(format!("expected refusals, got {error}").into()),
    }
}

fn options(text: &str) -> TestResult<JsonValue> {
    Ok(serde_json::from_str(text)?)
}

#[test]
fn the_client_probe_refuses_every_kind_when_asked() {
    let ir = reference_ir().unwrap();
    let unsupported = options(r#"{ "unsupportedKind": true }"#).unwrap();
    let refused = refused_of(
        PROBE_CLIENT
            .generate(&GenerateRequest::new(&ir).with_options(&unsupported))
            .unwrap_err(),
    )
    .unwrap();
    let codes: Vec<&str> = refused
        .0
        .iter()
        .map(|refusal| refusal.code.as_str())
        .collect();

    assert!(codes.contains(&"ir.kind.unsupported"), "codes {codes:?}");
    assert!(
        refused
            .0
            .iter()
            .all(|refusal| refusal.message.contains("probe-client 1.0.0 expects none")),
        "{refused:?}"
    );
}

#[test]
fn the_client_probe_refuses_a_missing_client_link() {
    let ir = reference_ir().unwrap();
    let matrix = CompatibilityMatrix::parse().unwrap();
    let metadata = PROBE_CLIENT.metadata();
    let needs = resolve_link_needs(&metadata.consumes, metadata.compatibility, &matrix).unwrap();
    let refused = refused_of(
        PROBE_CLIENT
            .generate(&GenerateRequest::new(&ir).with_needs(&needs))
            .unwrap_err(),
    )
    .unwrap();
    let codes: Vec<&str> = refused
        .0
        .iter()
        .map(|refusal| refusal.code.as_str())
        .collect();

    assert_eq!(codes, ["link.missing"]);
    assert!(
        refused.0.iter().any(|refusal| refusal
            .fix
            .contains("`@seampact/codegen-fetch` or `@seampact/codegen-axios`")),
        "{refused:?}"
    );
}

#[test]
fn the_server_probe_echoes_its_request_with_the_defaults_applied() {
    let ir = reference_ir().unwrap();
    let echo =
        options(r#"{ "echo": true, "files": [{ "path": "a.ts", "contents": "x" }] }"#).unwrap();
    let generated = PROBE_SERVER
        .generate(&GenerateRequest::new(&ir).with_options(&echo))
        .unwrap();
    let paths: Vec<&str> = generated
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect();
    let request: serde_json::Value =
        serde_json::from_str(&generated.files.last().unwrap().contents).unwrap();

    assert_eq!(paths, ["a.ts", "request.json"]);
    assert_eq!(request["frameworkRoutes"]["status"], "on");
    assert_eq!(request["hookCheck"], "error");
    assert_eq!(request["importSpecifiers"], "js");
    assert_eq!(
        request["installedRuntimes"]["probe-runtime"],
        serde_json::Value::Null
    );
    assert_eq!(request["api"], ir.api.id.as_str());
}
