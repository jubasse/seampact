//! Relay routes whose target is an imported api's IR: the importing api compiled with the
//! reference `tasks` IR as an import gives the IR it gives with `tasks` in the workspace, and an
//! import that contradicts itself is refused with a located diagnostic.

use std::error::Error;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_compiler::{PipelineOptions, PipelineResult, compile_workspace};
use seampact_ir::{ContractIr, ImportedIr};
use seampact_load::{LoadOptions, MemoryReader};
use serde_json::Value;

const TASKS_IR: &str = include_str!("../../../fixtures/golden/reference/tasks.ir.json");
const SERVICE_IR: &str = include_str!("../../../fixtures/golden/reference/tasksService.ir.json");
const SERVICE: &str = "tasksService";
const ROUTES: &str = "/surfaces/internal/routes";

fn fixture_text(path: &str) -> Result<String, Box<dyn Error>> {
    let file = Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/reference")
        .join(path);

    Ok(std::fs::read_to_string(file)?)
}

fn service_api(catalogues: &str, routes: &str) -> String {
    format!(
        "api:\n  name: {SERVICE}\n  version: 1\n  kind: service\n  caller: {{ identity: service, right: callerService }}\n  maturity: provisional\n\
         {catalogues}surfaces:\n  internal:\n    prefix: /internal/v{{version}}\n    requires: [{{ right: callerService, params: {{ allowed: [catalog] }} }}]\n    routes:\n{routes}"
    )
}

const ACCEPTED_ROUTES: &str = "      getTask: { relays: tasks.getTask }
      listTasks: { relays: tasks.listTasks }
      updateTask: { relays: tasks.updateTask }
";

// The workspace holds the service api only; `tasks` is an import.
fn service_reader(catalogues: &str, routes: &str) -> Result<MemoryReader, Box<dyn Error>> {
    let workspace = format!(
        "workspace:\n  apis:\n    {SERVICE}: ./service/api.yaml\n  shared: ./shared/base.yaml\n"
    );

    Ok(MemoryReader::new([
        ("workspace.yaml".to_owned(), workspace),
        (
            "shared/base.yaml".to_owned(),
            fixture_text("shared/base.yaml")?,
        ),
        (
            "shared/schemas.yaml".to_owned(),
            fixture_text("shared/schemas.yaml")?,
        ),
        (
            "service/api.yaml".to_owned(),
            service_api(catalogues, routes),
        ),
    ]))
}

fn imported_tasks(
    edit: impl FnOnce(&mut Value) -> Result<(), Box<dyn Error>>,
) -> Result<ImportedIr, Box<dyn Error>> {
    let mut ir: Value = serde_json::from_str(TASKS_IR)?;

    edit(&mut ir)?;

    Ok(ImportedIr::from_json_text(&ir.to_string())?)
}

fn operation<'ir>(ir: &'ir mut Value, id: &str) -> Result<&'ir mut Value, Box<dyn Error>> {
    ir["operations"]
        .as_array_mut()
        .and_then(|operations| {
            operations
                .iter_mut()
                .find(|operation| operation["id"] == id)
        })
        .ok_or_else(|| format!("the tasks IR has no operation {id}").into())
}

fn compile_service_with(
    catalogues: &str,
    routes: &str,
    imported: ImportedIr,
) -> Result<PipelineResult, Box<dyn Error>> {
    let reader = service_reader(catalogues, routes)?;
    let imports = IndexMap::from([("tasks".to_owned(), imported)]);
    let options = PipelineOptions {
        load: LoadOptions {
            reader: &reader,
            entry: "workspace.yaml",
        },
        imports: &imports,
    };

    Ok(compile_workspace(&options)?)
}

fn compile_service(routes: &str, imported: ImportedIr) -> Result<PipelineResult, Box<dyn Error>> {
    compile_service_with("", routes, imported)
}

fn located(result: &PipelineResult) -> Vec<(String, String)> {
    result
        .apis
        .iter()
        .flat_map(|api| api.diagnostics.iter())
        .chain(result.diagnostics.iter())
        .map(|diagnostic| {
            (
                diagnostic.rule.to_string(),
                diagnostic.origin.pointer.clone(),
            )
        })
        .collect()
}

#[test]
fn an_operation_outside_its_surface_prefix_is_refused_and_located() -> Result<(), Box<dyn Error>> {
    let imported = imported_tasks(|ir| {
        operation(ir, "getTask")?["path"] = Value::from("/elsewhere/tasks/{taskId}");

        Ok(())
    })?;
    let result = compile_service(ACCEPTED_ROUTES, imported)?;

    assert_eq!(
        located(&result),
        [(
            "seampact/tree/relay-target".to_owned(),
            format!("{ROUTES}/getTask/relays")
        )]
    );

    Ok(())
}

fn refused(rule: &str, route: &str) -> Vec<(String, String)> {
    vec![(
        format!("seampact/{rule}"),
        format!("{ROUTES}/{route}/relays"),
    )]
}

fn message_of(result: &PipelineResult) -> String {
    result
        .apis
        .iter()
        .flat_map(|api| api.diagnostics.iter())
        .map(|diagnostic| diagnostic.message.clone())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn a_relay_of_an_imported_api_compiles_to_the_ir_of_a_relay_inside_the_workspace()
-> Result<(), Box<dyn Error>> {
    let routes = "      getTask: { relays: tasks.getTask }\n";
    let result = compile_service(routes, imported_tasks(|_| Ok(()))?)?;
    let golden_service = ContractIr::from_json_text(SERVICE_IR)?;
    let api = result.apis.first().ok_or("the run has no api")?;

    assert_eq!(located(&result), Vec::new());
    assert_eq!(api.ir.as_ref(), Some(&golden_service));

    Ok(())
}

#[test]
fn an_operation_that_contradicts_its_own_ir_is_refused_and_located() -> Result<(), Box<dyn Error>> {
    type Edit = fn(&mut Value) -> Result<(), Box<dyn Error>>;

    let cases: [(&str, Edit, &str, &str); 5] = [
        (
            "outside the prefix",
            |ir| {
                operation(ir, "getTask")?["path"] = Value::from("/elsewhere/tasks/{taskId}");
                Ok(())
            },
            "tree/relay-target",
            "getTask",
        ),
        (
            "in the next segment of the prefix",
            |ir| {
                operation(ir, "getTask")?["path"] = Value::from("/internal/v10/tasks/{taskId}");
                Ok(())
            },
            "tree/relay-target",
            "getTask",
        ),
        (
            "on a surface the import lacks",
            |ir| {
                operation(ir, "getTask")?["surface"] = Value::from("ghostSurface");
                Ok(())
            },
            "tree/relay-target",
            "getTask",
        ),
        (
            "with a format the import lacks",
            |ir| {
                operation(ir, "listTasks")?["format"] = Value::from("missing");
                Ok(())
            },
            "tree/relay-target",
            "listTasks",
        ),
        (
            "with a paging style the import lacks",
            |ir| {
                operation(ir, "listTasks")?["paging"]["style"] = Value::from("missing");
                Ok(())
            },
            "tree/relay-target",
            "listTasks",
        ),
    ];

    for (name, edit, rule, route) in cases {
        let imported = imported_tasks(edit)?;
        let result = compile_service(ACCEPTED_ROUTES, imported)?;

        assert_eq!(located(&result), refused(rule, route), "{name}");
    }

    Ok(())
}

#[test]
fn an_imported_operation_of_a_kind_this_compiler_does_not_know_is_refused_as_unknown()
-> Result<(), Box<dyn Error>> {
    let imported = imported_tasks(|ir| {
        operation(ir, "getTask")?["kind"] = Value::from("grpcOperation");

        Ok(())
    })?;
    let result = compile_service(ACCEPTED_ROUTES, imported)?;

    assert_eq!(located(&result), refused("tree/relay-unknown", "getTask"));
    assert!(message_of(&result).contains("grpcOperation"));

    Ok(())
}

#[test]
fn an_imported_operation_holding_an_unknown_member_is_refused_once_naming_it()
-> Result<(), Box<dyn Error>> {
    let imported = imported_tasks(|ir| {
        operation(ir, "getTask")?["retryBudget"] = Value::from(3);

        Ok(())
    })?;
    let result = compile_service(ACCEPTED_ROUTES, imported)?;

    assert_eq!(located(&result), refused("tree/relay-unknown", "getTask"));
    assert!(
        message_of(&result).contains("retryBudget at /operations/"),
        "{}",
        message_of(&result)
    );

    Ok(())
}

#[test]
fn an_imported_paging_style_holding_an_unknown_member_is_refused_not_copied()
-> Result<(), Box<dyn Error>> {
    let imported = imported_tasks(|ir| {
        ir["pagings"]["cursor"]["weight"] = Value::from(1);

        Ok(())
    })?;
    let result = compile_service(ACCEPTED_ROUTES, imported)?;

    assert_eq!(located(&result), refused("tree/relay-unknown", "listTasks"));
    assert!(message_of(&result).contains("weight at /pagings/cursor/weight"));

    Ok(())
}

#[test]
fn a_code_the_importing_api_lacks_is_refused_at_the_relay_route() -> Result<(), Box<dyn Error>> {
    let imported = imported_tasks(|ir| {
        let get_task = operation(ir, "getTask")?;
        let mut locked = get_task["errors"][0].clone();

        locked["code"] = Value::from("tasks.locked");
        locked["derivedFrom"]["derivation"] = Value::from("node.errors");

        if let Some(entry) = locked.as_object_mut() {
            entry.remove("roles");
        }

        get_task["errors"]
            .as_array_mut()
            .ok_or("getTask has no errors")?
            .push(locked);

        let mut declaration = ir["errors"]["api.schema_invalid"].clone();

        declaration["code"] = Value::from("tasks.locked");
        ir["errors"]["tasks.locked"] = declaration;

        Ok(())
    })?;
    let routes = "      getTask: { relays: tasks.getTask }\n";
    let result = compile_service(routes, imported)?;

    assert_eq!(
        located(&result),
        refused("derive/relay-declaration", "getTask")
    );

    Ok(())
}

#[test]
fn an_imported_public_operation_is_read_from_its_ir_by_the_link_pass() -> Result<(), Box<dyn Error>>
{
    let catalogues = "errors:\n  service.invalid: { status: 400, nature: refused, params: { issues: Issues } }\n\n\
        conventions:\n  errors:\n    derived:\n      schemaInvalid:\n        code: service.invalid\n        \
        params: { issues: { $each: $issues, $as: { pointer: $item.pointer, rule: $item.rule } } }\n\n";
    let routes = "      getTask: { relays: tasks.getTask }\n";
    let result = compile_service_with(catalogues, routes, imported_tasks(|_| Ok(()))?)?;

    assert_eq!(located(&result), refused("link/relay-superset", "getTask"));
    assert!(message_of(&result).contains(
        "The relay route tasksService.getTask does not answer the code 'api.schema_invalid', which tasks.getTask answers for the role 'schemaInvalid'."
    ));

    Ok(())
}
