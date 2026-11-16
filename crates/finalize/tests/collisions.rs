//! The id collision check: two catalogues sharing an id, an error code equal to a component name,
//! and the located side of a core declaration.

mod support;

use seampact_finalize::{FINALIZE_ID_COLLISION_RULE, finalize_id_collisions};
use serde_json::json;
use support::json;

type TestResult = Result<(), String>;

fn api_origin(pointer: &str) -> serde_json::Value {
    json!({ "layer": "api", "pointer": pointer })
}

#[test]
fn a_schema_and_an_enum_with_one_id_collide_at_the_schema() -> TestResult {
    let ir = json(&json!({
        "schemas": { "Task": { "origin": api_origin("/schemas/Task") } },
        "enums": { "Task": { "origin": api_origin("/enums/Task") } }
    }))?;

    let diagnostics = finalize_id_collisions(&ir).map_err(|error| error.to_string())?;
    let [collision] = diagnostics.as_slice() else {
        return Err(format!("expected one collision, got {diagnostics:?}"));
    };

    assert_eq!(collision.rule.as_str(), FINALIZE_ID_COLLISION_RULE);
    assert_eq!(collision.origin.pointer, "/schemas/Task");
    assert_eq!(collision.fix, "Rename one of them.");
    assert!(
        collision
            .message
            .starts_with("The schema 'Task' and the enum 'Task' have one id"),
        "message {}",
        collision.message
    );
    assert_eq!(collision.related.len(), 1);

    Ok(())
}

#[test]
fn an_error_code_equal_to_a_schema_id_collides_at_the_code() -> TestResult {
    let ir = json(&json!({
        "schemas": { "Task": { "origin": api_origin("/schemas/Task") } },
        "errors": { "Task": { "origin": api_origin("/errors/Task") } }
    }))?;

    let diagnostics = finalize_id_collisions(&ir).map_err(|error| error.to_string())?;
    let [collision] = diagnostics.as_slice() else {
        return Err(format!("expected one collision, got {diagnostics:?}"));
    };

    assert_eq!(collision.origin.pointer, "/errors/Task");
    assert_eq!(collision.fix, "Rename the code.");

    Ok(())
}

#[test]
fn a_core_side_is_named_but_the_diagnostic_is_located_at_the_other_side() -> TestResult {
    let ir = json(&json!({
        "schemas": { "Task": { "origin": { "layer": "core", "pointer": "/schemas/Task" } } },
        "enums": { "Task": { "origin": api_origin("/enums/Task") } }
    }))?;

    let diagnostics = finalize_id_collisions(&ir).map_err(|error| error.to_string())?;
    let [collision] = diagnostics.as_slice() else {
        return Err(format!("expected one collision, got {diagnostics:?}"));
    };

    assert_eq!(collision.origin.pointer, "/enums/Task");
    assert_eq!(collision.related, Vec::new());

    Ok(())
}

#[test]
fn two_core_sides_are_an_internal_error() -> TestResult {
    let core = json!({ "layer": "core", "pointer": "/x" });
    let ir = json(&json!({
        "schemas": { "Task": { "origin": core } },
        "enums": { "Task": { "origin": core } }
    }))?;

    assert!(finalize_id_collisions(&ir).is_err());

    Ok(())
}

#[test]
fn a_strict_input_name_collides_with_an_enum_of_that_name() -> TestResult {
    let ir = json(&json!({
        "schemas": { "Task": { "origin": api_origin("/schemas/Task") } },
        "enums": { "Task.input": { "origin": api_origin("/enums/x") } }
    }))?;

    let diagnostics = finalize_id_collisions(&ir).map_err(|error| error.to_string())?;

    assert_eq!(diagnostics.len(), 1, "diagnostics {diagnostics:?}");

    Ok(())
}

#[test]
fn distinct_ids_do_not_collide_and_a_non_ascii_id_is_kept_as_written() -> TestResult {
    let ir = json(&json!({
        "schemas": { "\u{1F600}": { "origin": api_origin("/schemas/a") } },
        "enums": { "\u{E000}": { "origin": api_origin("/enums/a") } }
    }))?;

    assert_eq!(
        finalize_id_collisions(&ir).map_err(|error| error.to_string())?,
        Vec::new()
    );

    Ok(())
}
