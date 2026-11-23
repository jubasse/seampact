//! `plan_app_documents` and `plan_merged_documents` on the cases of the TypeScript
//! `document-plan.test.ts`, and the key order of the `openapi` mapping.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::type_complexity,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_cli_config::{
    ApiDocuments, AppConfigEntry, AppDocumentPlan, LoadedAppConfig, LoadedMergedDocument,
    LoadedRootConfig, LoadedWorkspace, LoadedWorkspaceApp, MergedContribution, MergedDocumentPlan,
    OperationsFilter, WorkspaceApp, plan_app_documents, plan_merged_documents,
};
use seampact_json::JsonValue;
use seampact_target::TargetRole;
use serde_json::{Value, json};

fn json_of(value: Value) -> JsonValue {
    JsonValue::try_from(value).expect("a JSON value")
}

fn app_config(entries: Vec<Value>, openapi: Option<Value>) -> LoadedAppConfig {
    LoadedAppConfig {
        file: Utf8PathBuf::from("/repo/app/seampact.config.yaml"),
        out_dir: Utf8PathBuf::from("/repo/app/__generated__"),
        allow_local: None,
        sources: IndexMap::new(),
        entries: entries
            .into_iter()
            .map(|entry| {
                let name = entry["out"]
                    .as_str()
                    .or(entry["id"].as_str())
                    .expect("an id");

                AppConfigEntry {
                    root: Utf8PathBuf::from(format!("/repo/app/__generated__/{name}")),
                    entry: json_of(entry),
                }
            })
            .collect(),
        openapi: openapi.map(json_of),
        checks: None,
        diff: None,
        warnings: None,
        root_file: None,
    }
}

fn api_documents() -> Vec<ApiDocuments> {
    let api = |name: &str, documents: &[&str]| ApiDocuments {
        source: "contracts".to_owned(),
        api: name.to_owned(),
        documents: documents.iter().map(|each| (*each).to_owned()).collect(),
    };

    vec![api("tasks", &["public", "full"]), api("billing", &[])]
}

fn roles() -> IndexMap<String, TargetRole> {
    IndexMap::from([
        ("server".to_owned(), TargetRole::Server),
        ("client".to_owned(), TargetRole::Client),
    ])
}

fn server() -> Value {
    json!({ "id": "server", "use": "nestjs", "apis": ["tasks", "contracts/billing"] })
}

fn client() -> Value {
    json!({ "id": "client", "use": "fetch", "api": "tasks" })
}

/// `(api, document, file, options)` of each planned document, or the refusal codes.
fn planned_files(
    config: &LoadedAppConfig,
) -> Result<Vec<(String, Option<String>, String, Value)>, Vec<String>> {
    match plan_app_documents(config, &roles(), &api_documents()).expect("a plan") {
        AppDocumentPlan::Planned(documents) => Ok(documents
            .into_iter()
            .map(|each| {
                let options = serde_json::to_value(&each.options).expect("options");

                (each.api, each.document, each.file.to_string(), options)
            })
            .collect()),
        AppDocumentPlan::Refused(problems) => {
            Err(problems.into_iter().map(|problem| problem.code).collect())
        }
    }
}

fn file(
    api: &str,
    document: Option<&str>,
    path: &str,
    options: Value,
) -> (String, Option<String>, String, Value) {
    (
        api.to_owned(),
        document.map(str::to_owned),
        path.to_owned(),
        options,
    )
}

#[test]
fn every_document_of_every_served_api_is_written_without_an_openapi_key() {
    assert_eq!(
        planned_files(&app_config(vec![server(), client()], None)),
        Ok(vec![
            file(
                "tasks",
                Some("public"),
                "/repo/app/openapi/tasks.public.yaml",
                json!({})
            ),
            file(
                "tasks",
                Some("full"),
                "/repo/app/openapi/tasks.full.yaml",
                json!({})
            ),
            file("billing", None, "/repo/app/openapi/billing.yaml", json!({})),
        ])
    );
}

#[test]
fn client_targets_only_or_openapi_none_write_nothing() {
    assert_eq!(planned_files(&app_config(vec![client()], None)), Ok(vec![]));
    assert_eq!(
        planned_files(&app_config(vec![server()], Some(json!("none")))),
        Ok(vec![])
    );
}

#[test]
fn the_listed_documents_are_written_with_their_options() {
    let openapi = json!({
        "tasks": {
            "public": "docs/public.yaml",
            "full": { "path": "docs/full.yaml", "reasons": "omit", "extensions": ["access"] }
        },
        "billing": { "path": "../billing.yaml", "servers": [{ "url": "https://billing.example.com" }] }
    });
    let expected = Ok(vec![
        file(
            "tasks",
            Some("public"),
            "/repo/app/docs/public.yaml",
            json!({}),
        ),
        file(
            "tasks",
            Some("full"),
            "/repo/app/docs/full.yaml",
            json!({ "reasons": "omit", "extensions": ["access"] }),
        ),
        file(
            "billing",
            None,
            "/repo/billing.yaml",
            json!({ "servers": [{ "url": "https://billing.example.com" }] }),
        ),
    ]);

    assert_eq!(
        planned_files(&app_config(vec![client()], Some(openapi.clone()))),
        expected
    );
    assert_eq!(planned_files(&app_config(vec![], Some(openapi))), expected);
}

#[test]
fn a_listed_api_or_document_the_sources_do_not_hold_is_refused() {
    let refused = |openapi: Value| planned_files(&app_config(vec![], Some(openapi)));

    assert_eq!(
        refused(json!({ "tasks": "tasks.yaml" })),
        Err(vec!["config.openapi.document-needed".to_owned()])
    );
    assert_eq!(
        refused(json!({ "billing": { "full": "b.yaml" } })),
        Err(vec!["config.openapi.no-documents".to_owned()])
    );
    assert_eq!(
        refused(json!({ "tasks": { "internal": "t.yaml" } })),
        Err(vec!["config.openapi.unknown-document".to_owned()])
    );
    assert_eq!(
        refused(json!({ "orders": "o.yaml" })),
        Err(vec!["config.openapi.unknown-api".to_owned()])
    );

    let mut two_sources = api_documents();

    two_sources.push(ApiDocuments {
        source: "other".to_owned(),
        api: "tasks".to_owned(),
        documents: vec!["public".to_owned()],
    });

    let config = app_config(vec![], Some(json!({ "tasks": { "public": "t.yaml" } })));
    let AppDocumentPlan::Refused(problems) =
        plan_app_documents(&config, &roles(), &two_sources).expect("a plan")
    else {
        panic!("planned");
    };

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, "config.openapi.ambiguous-api");
    assert_eq!(
        problems[0].message,
        "The api 'tasks' exists in the sources 'contracts', 'other', and 'openapi' names an api alone."
    );
}

#[test]
fn two_documents_on_one_path_and_a_document_inside_an_output_directory_are_refused() {
    assert_eq!(
        planned_files(&app_config(
            vec![],
            Some(json!({ "tasks": { "public": "same.yaml", "full": "same.yaml" } }))
        )),
        Err(vec!["config.openapi.path-conflict".to_owned()])
    );
    assert_eq!(
        planned_files(&app_config(
            vec![client()],
            Some(json!({ "billing": "__generated__/client/billing.yaml" }))
        )),
        Err(vec!["config.openapi.inside-output".to_owned()])
    );
}

#[test]
fn the_mapping_is_read_in_javascript_key_order() {
    let documents = vec![ApiDocuments {
        source: "contracts".to_owned(),
        api: "tasks".to_owned(),
        documents: vec!["b".to_owned(), "10".to_owned(), "2".to_owned()],
    }];
    let config = app_config(
        vec![],
        Some(json!({ "tasks": { "b": "b.yaml", "10": "10.yaml", "2": "2.yaml" } })),
    );
    let AppDocumentPlan::Planned(planned) =
        plan_app_documents(&config, &roles(), &documents).expect("a plan")
    else {
        panic!("refused");
    };
    let names: Vec<Option<&str>> = planned
        .iter()
        .map(|each| each.document.as_deref())
        .collect();

    assert_eq!(names, [Some("2"), Some("10"), Some("b")]);
}

fn workspace_app(name: &str, config: LoadedAppConfig) -> LoadedWorkspaceApp {
    LoadedWorkspaceApp {
        app: WorkspaceApp {
            name: name.to_owned(),
            directory: Utf8PathBuf::from(format!("/repo/{name}")),
            file: Utf8PathBuf::from(format!("/repo/{name}/seampact.config.yaml")),
        },
        config,
    }
}

fn merged(name: &str, apps: &[&str], prefix: Value, options: Value) -> LoadedMergedDocument {
    LoadedMergedDocument {
        name: name.to_owned(),
        file: Utf8PathBuf::from(format!("/repo/openapi/{name}.yaml")),
        apps: apps.iter().map(|each| (*each).to_owned()).collect(),
        prefix: json_of(prefix),
        options: json_of(options),
    }
}

#[test]
fn a_merged_document_takes_server_entries_and_openapi_only_apps() {
    let served = json!({
        "id": "server", "use": "nestjs", "apis": ["tasks", "contracts/billing"],
        "document": "public", "operations": { "exclude": ["admin"] }
    });
    let workspace = LoadedWorkspace {
        root: LoadedRootConfig {
            file: Utf8PathBuf::from("/repo/seampact.config.yaml"),
            display_name: "seampact.config.yaml".to_owned(),
            apps: vec![],
            sources: IndexMap::new(),
            allow_local: None,
            openapi: vec![
                merged(
                    "platform",
                    &["api", "billing", "web"],
                    json!({ "billing": "billing" }),
                    json!({ "extensions": "none" }),
                ),
                merged("api", &["api"], json!({}), json!({})),
            ],
            checks: json_of(json!({})),
        },
        apps: vec![
            workspace_app("api", app_config(vec![served, client()], None)),
            workspace_app(
                "billing",
                app_config(
                    vec![],
                    Some(
                        json!({ "billing": "openapi/billing.yaml", "tasks": { "full": "t.yaml" } }),
                    ),
                ),
            ),
            workspace_app(
                "web",
                app_config(
                    vec![client()],
                    Some(json!({ "tasks": { "public": "t.yaml" } })),
                ),
            ),
        ],
    };
    let roles_by_app = IndexMap::from([("api".to_owned(), roles()), ("web".to_owned(), roles())]);
    let MergedDocumentPlan::Planned(documents) =
        plan_merged_documents(&workspace, &roles_by_app).expect("a plan")
    else {
        panic!("refused");
    };
    let from_api = |api: &str| MergedContribution {
        app: "api".to_owned(),
        api: api.to_owned(),
        entry: Some("server".to_owned()),
        document: Some("public".to_owned()),
        operations: Some(OperationsFilter {
            include: None,
            exclude: Some(vec!["admin".to_owned()]),
        }),
    };
    let own = |app: &str, api: &str, document: Option<&str>| MergedContribution {
        app: app.to_owned(),
        api: api.to_owned(),
        entry: None,
        document: document.map(str::to_owned),
        operations: None,
    };

    assert_eq!(documents.len(), 2);
    assert_eq!(documents[0].name, "platform");
    assert_eq!(
        documents[0].contributions,
        [
            from_api("tasks"),
            from_api("contracts/billing"),
            own("billing", "billing", None),
            own("billing", "tasks", Some("full")),
        ]
    );
    assert_eq!(
        documents[1].contributions,
        [from_api("tasks"), from_api("contracts/billing")]
    );
}

#[test]
fn two_merged_documents_on_one_file_are_refused() {
    let mut second = merged("other", &[], json!({}), json!({}));

    second.file = Utf8PathBuf::from("/repo/openapi/first.yaml");

    let workspace = LoadedWorkspace {
        root: LoadedRootConfig {
            file: Utf8PathBuf::from("/repo/seampact.config.yaml"),
            display_name: "seampact.config.yaml".to_owned(),
            apps: vec![],
            sources: IndexMap::new(),
            allow_local: None,
            openapi: vec![merged("first", &[], json!({}), json!({})), second],
            checks: json_of(json!({})),
        },
        apps: vec![],
    };
    let MergedDocumentPlan::Refused(problems) =
        plan_merged_documents(&workspace, &IndexMap::new()).expect("a plan")
    else {
        panic!("planned");
    };

    assert_eq!(problems[0].code, "config.openapi.path-conflict");
    assert_eq!(
        problems[0].message,
        "The documents 'first' and 'other' are both written to /repo/openapi/first.yaml."
    );
}
