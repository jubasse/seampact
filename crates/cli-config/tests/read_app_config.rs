//! The app config reader on small config trees.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use std::fmt::Write as _;

use seampact_cli_config::{ReadAppConfigOutcome, ResolvedSource};
use seampact_json::JsonValue;
use support::{SERVER_ENTRY_HEAD, read_config, read_text, read_tree_app, refused, write_tree};

fn entry_member(text: &str, member: &str) -> Option<JsonValue> {
    let config = read_config(read_text(text));
    let JsonValue::Object(entry) = &config.entries.first().expect("an entry").entry else {
        panic!("an entry is a mapping");
    };

    entry.get(member).cloned()
}

fn first_problem_message(text: &str) -> String {
    refused(read_text(text)).remove(0).message
}

fn with_head(tail: &str) -> String {
    format!("{SERVER_ENTRY_HEAD}{tail}")
}

#[test]
fn a_reserved_key_is_refused_written_directly_or_as_an_alias() {
    let direct = "sources:\n  contracts: { path: ./c }\ntargets:\n  - { id: t, use: x, api: a, options: { __proto__: { polluted: true } } }\n";
    let aliased = "sources:\n  contracts: { path: ./c }\ntargets:\n  - id: t\n    use: x\n    api: a\n    options: { name: &k __proto__, ? *k : { polluted: true } }\n";

    for text in [direct, aliased] {
        let problems = refused(read_text(text));

        assert_eq!(problems.len(), 1, "{text}");
        assert_eq!(problems[0].code, "config.key.reserved", "{text}");
        assert!(problems[0].message.contains("'__proto__'"), "{text}");
    }
}

#[test]
fn framework_route_patterns_with_a_star_inside_a_segment_are_read() {
    for path in [
        "/livewire-*/**",
        "/livewire*/**",
        "/*.json",
        "/a/*-*/z",
        "/metrics",
    ] {
        let text = with_head(&format!(
            "    frameworkRoutes:\n      - {{ path: '{path}', reason: r }}\n"
        ));

        assert!(entry_member(&text, "frameworkRoutes").is_some(), "{path}");
    }
}

#[test]
fn the_boot_check_switches_are_read_and_a_bad_one_is_named() {
    for switch in ["false", "strict"] {
        let text = with_head(&format!(
            "    artefacts: {{ bootCheck: {{ frameworkRoutes: {switch} }} }}\n"
        ));

        assert!(entry_member(&text, "artefacts").is_some(), "{switch}");
    }

    let text = with_head("    artefacts: { bootCheck: { frameworkRoutes: all } }\n");
    let problems = refused(read_text(&text));

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, "config.schema");
    assert_eq!(
        problems[0].message,
        "'bootCheck.frameworkRoutes' is true, false or 'strict'."
    );

    let text = with_head("    artefacts: { bootCheck: on }\n");

    assert!(first_problem_message(&text).contains("'bootCheck' is true, false"));
}

#[test]
fn a_mount_is_read_or_refused_with_its_rule() {
    for mount in ["/api", "/api/v2", "/my-app.v1", "/.well", "/v1..2"] {
        let text = with_head(&format!("    mount: {mount}\n"));

        assert_eq!(
            entry_member(&text, "mount"),
            Some(JsonValue::String(mount.to_owned())),
            "{mount}"
        );
    }

    for mount in [
        "api",
        "/api/",
        "/",
        "/api/*",
        "/api//v1",
        "'/my api'",
        "'/{tenant}'",
        "/caf%C3%A9",
        "/café",
        "/api/.",
        "/..",
        "/api/../v1",
    ] {
        let problems = refused(read_text(&with_head(&format!("    mount: {mount}\n"))));

        assert_eq!(problems[0].code, "config.schema", "{mount}");
        assert!(problems[0].message.contains("'mount'"), "{mount}");
    }

    assert_eq!(
        first_problem_message(&with_head("    mount: /..\n")),
        "The key 'mount' is '/' then segments of ASCII letters, digits and '-._~!$&'()+,;=@:', with no trailing '/', no '*', no '.' or '..' segment and no segment starting with ':'."
    );
}

#[test]
fn an_allow_untested_item_is_read_or_refused_by_name() {
    for item in ["express@6", "fastapi@0.162", "fastapi@0.0"] {
        assert!(
            entry_member(
                &with_head(&format!("    allowUntested: [{item}]\n")),
                "allowUntested"
            )
            .is_some(),
            "{item}"
        );
    }

    for item in [
        "express@6.1",
        "express@0",
        "fastapi@0.01",
        "fastapi@0.",
        "express",
    ] {
        let problems = refused(read_text(&with_head(&format!(
            "    allowUntested: [{item}]\n"
        ))));

        assert_eq!(problems[0].code, "config.schema", "{item}");
        assert!(
            problems[0].message.contains("An `allowUntested` item is"),
            "{item}"
        );
        assert!(problems[0].fix.contains("fastapi@0.162"), "{item}");
    }
}

#[test]
fn an_allow_list_beside_a_switched_off_check_conflicts() {
    for switch in [
        "{ bootCheck: { frameworkRoutes: false } }",
        "{ bootCheck: false }",
    ] {
        let text = with_head(&format!(
            "    artefacts: {switch}\n    frameworkRoutes:\n      - {{ path: /metrics, reason: r }}\n"
        ));
        let problems = refused(read_text(&text));

        assert_eq!(problems.len(), 1, "{switch}");
        assert_eq!(problems[0].code, "config.key.conflict", "{switch}");
        assert!(
            problems[0]
                .message
                .contains("'server' allow-lists framework routes"),
            "{switch}"
        );
    }
}

#[test]
fn framework_docs_off_conflicts_with_native_docs() {
    for value in ["keep", "off"] {
        assert!(
            entry_member(
                &with_head(&format!("    frameworkDocs: {value}\n")),
                "frameworkDocs"
            )
            .is_some()
        );
    }

    let problems = refused(read_text(&with_head(
        "    frameworkDocs: off\n    artefacts: { nativeDocs: true }\n",
    )));

    assert_eq!(problems[0].code, "config.key.conflict");
    assert!(
        problems[0].message.contains("frameworkDocs: off")
            && problems[0].message.contains("artefacts.nativeDocs: true")
    );
}

#[test]
fn a_bad_framework_route_is_refused_with_its_sentence() {
    let rule = "The key 'path' of a framework route is '/' then segments, each '*', '**', or text without '?', '{' or '}' holding at most two '*'.";

    for (route, sentence) in [
        ("{ path: /metrics }", "The key 'reason' is required here."),
        (
            "{ path: /metrics, reason: \"\" }",
            "The value must NOT have fewer than 1 characters.",
        ),
        ("{ path: '/metrics**', reason: r }", rule),
        ("{ path: '/a/***', reason: r }", rule),
        ("{ path: '/a/b?', reason: r }", rule),
        ("{ path: '/a/{id}', reason: r }", rule),
        ("{ path: metrics, reason: r }", rule),
        (
            "{ method: get, path: /metrics, reason: r }",
            "The value must be equal to one of the allowed values.",
        ),
    ] {
        let text = with_head(&format!("    frameworkRoutes:\n      - {route}\n"));

        assert!(first_problem_message(&text).contains(sentence), "{route}");
    }
}

#[test]
fn artefact_switches_and_waiting_keys() {
    let read = read_config(read_text(&with_head(
        "    artefacts: { types: false, nativeDocs: true, bootCheck: false }\n    allowUntested: [express@6]\nchecks: { matrix: error }\n",
    )));

    assert!(read.checks.is_some());
    assert!(
        first_problem_message(&with_head("    artefacts: { types: off }\n"))
            .contains("must be boolean")
    );

    for (tail, named) in [
        ("    access: { native: \"Spring Security.\" }\n", "'access'"),
        (
            "    artefacts: { bootCheck: { handlers: false } }\n",
            "'handlers'",
        ),
        (
            "    link: { validators: { module: x } }\n",
            "explicit module specifier",
        ),
    ] {
        let problems = refused(read_text(&with_head(tail)));

        assert_eq!(problems.len(), 1, "{tail}");
        assert_eq!(problems[0].code, "config.key.waits", "{tail}");
        assert!(problems[0].message.contains(named), "{tail}");
    }
}

#[test]
fn package_and_maven_sources_are_checked() {
    let head = "targets:\n  - { id: t, use: x, api: a }\n";
    let bad = format!("sources:\n  contracts: {{ package: ../../x, version: 1.0.0 }}\n{head}");
    let scoped = format!(
        "sources:\n  contracts: {{ package: '@acme/tasks.contract', version: 1.0.0 }}\n{head}"
    );
    let maven = format!(
        "sources:\n  contracts: {{ maven: 'com.acme:tasks-contract:1.0.0', integrity: sha256-x }}\n{head}"
    );
    let versionless =
        format!("sources:\n  contracts: {{ maven: 'com.acme:tasks-contract' }}\n{head}");

    assert!(
        refused(read_text(&bad))[0]
            .location
            .as_deref()
            .is_some_and(|at| at.contains("sources.contracts"))
    );
    read_config(read_text(&scoped));
    read_config(read_text(&maven));
    assert_eq!(refused(read_text(&versionless))[0].code, "config.schema");

    for coordinate in ["..:..:1.0.0", ".:-:1.0.0"] {
        assert_eq!(
            refused(read_text(&format!(
                "sources:\n  contracts: {{ maven: '{coordinate}' }}\n"
            )))[0]
                .code,
            "config.schema"
        );
    }

    for version in ["+", "1.+", "latest.release", "[1.0,2.0)", "1.0-SNAPSHOT"] {
        let text =
            format!("sources:\n  contracts: {{ maven: 'com.acme:tasks-contract:{version}' }}\n");

        assert_eq!(
            refused(read_text(&text))[0].code,
            "config.source.maven-unpinned",
            "{version}"
        );
    }
}

#[test]
fn alias_expansion_past_the_budget_is_a_yaml_problem() {
    let doubling = |levels: usize| {
        let mut text = "checks:\n  l0: &l0 [x, x]\n".to_owned();

        for index in 0..levels - 1 {
            writeln!(
                text,
                "  l{}: &l{} [*l{index}, *l{index}]",
                index + 1,
                index + 1
            )
            .expect("a write to a String");
        }

        text
    };
    let over = refused(read_text(&doubling(6)));

    assert_eq!(over[0].code, "config.yaml.syntax");
    assert_eq!(
        over[0].message,
        "Excessive alias count indicates a resource exhaustion attack."
    );
    assert!(
        refused(read_text(&doubling(5)))
            .iter()
            .all(|problem| problem.code != "config.yaml.syntax")
    );
}

#[test]
fn openapi_checks_and_diff_are_read_as_written() {
    let read = read_config(read_text(
        "openapi:\n  tasks: { public: openapi/public.yaml, full: { path: openapi/full.yaml, reasons: omit } }\nchecks: {}\ndiff: { gate: both }\n",
    ));

    assert!(read.openapi.is_some() && read.checks.is_some() && read.diff.is_some());
    assert!(
        first_problem_message("openapi:\n  tasks: [openapi/tasks.yaml]\n")
            .contains("An api's documents are a path")
    );
}

#[test]
fn a_root_config_is_not_read_as_an_app_config() {
    let problems = refused(read_text(
        "apps: [api]\nopenapi: { all: { path: all.yaml, apps: [api] } }\n",
    ));

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, "config.root.not-an-app");
    assert_eq!(
        problems[0].location.as_deref(),
        Some("seampact.config.yaml:1:1 apps")
    );
}

const ROOT_FILES: [(&str, &str); 2] = [
    (
        "seampact.config.yaml",
        "apps: [apps/api]\nallowLocal: false\nsources:\n  shared: { path: ./contracts }\n",
    ),
    (
        "apps/api/seampact.config.yaml",
        "sources:\n  own: { path: ./contracts }\ntargets:\n  - { id: types, use: x, api: shared/tasks }\n",
    ),
];

#[test]
fn a_listed_app_folds_its_root_in() {
    let (_directory, root) = write_tree(&ROOT_FILES);
    let config = read_config(read_tree_app(&root, "apps/api"));

    assert_eq!(config.allow_local, Some(false));
    assert_eq!(config.root_file, Some(root.join("seampact.config.yaml")));

    let sources: Vec<(&String, &ResolvedSource)> = config.sources.iter().collect();

    assert_eq!(sources.len(), 2);
    assert_eq!(
        sources[0].1,
        &ResolvedSource::Path {
            directory: root.join("contracts")
        }
    );
    assert_eq!(
        sources[1].1,
        &ResolvedSource::Path {
            directory: root.join("apps/api/contracts")
        }
    );

    let (_other, allowing) = write_tree(&[
        ROOT_FILES[0],
        ("apps/api/seampact.config.yaml", "allowLocal: true\n"),
    ]);

    assert_eq!(
        read_config(read_tree_app(&allowing, "apps/api")).allow_local,
        Some(true)
    );
}

#[test]
fn a_source_defined_in_the_app_and_its_root_is_refused() {
    let (_directory, root) = write_tree(&[
        ROOT_FILES[0],
        (
            "apps/api/seampact.config.yaml",
            "sources:\n  shared: { path: ./mine }\n",
        ),
    ]);
    let problems = refused(read_tree_app(&root, "apps/api"));

    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, "config.source.duplicate");
    assert_eq!(
        problems[0].message,
        "The source 'shared' is defined both in this app config and in its root config seampact.config.yaml."
    );
    assert_eq!(
        problems[0].location.as_deref(),
        Some("apps/api/seampact.config.yaml:2:3 sources.shared")
    );
}

#[test]
fn an_app_the_nearest_root_does_not_list_stands_alone_unless_it_names_a_root_source() {
    let (_directory, root) = write_tree(&[
        ROOT_FILES[0],
        ROOT_FILES[1],
        (
            "apps/web/seampact.config.yaml",
            "sources:\n  own: { path: ./c }\n",
        ),
        ("apps/other/seampact.config.yaml", ROOT_FILES[1].1),
    ]);
    let web = read_config(read_tree_app(&root, "apps/web"));

    assert_eq!(web.sources.len(), 1);
    assert_eq!(web.root_file, None);

    let problems = refused(read_tree_app(&root, "apps/other"));

    assert_eq!(problems[0].code, "config.app.unlisted");
    assert!(
        problems[0]
            .message
            .contains("'shared/tasks' names a source of the root config seampact.config.yaml")
    );
    assert_eq!(
        problems[0].location.as_deref(),
        Some("apps/other/seampact.config.yaml:4:5 targets[0]")
    );
}

#[test]
fn the_search_walks_past_a_root_that_does_not_list_the_app() {
    let (_directory, root) = write_tree(&[
        ROOT_FILES[0],
        ROOT_FILES[1],
        ("apps/seampact.config.yaml", "apps: [other]\n"),
        (
            "apps/other/seampact.config.yaml",
            "sources:\n  own: { path: ./c }\n",
        ),
    ]);
    let config = read_config(read_tree_app(&root, "apps/api"));

    assert_eq!(config.root_file, Some(root.join("seampact.config.yaml")));
    assert_eq!(
        config
            .sources
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["shared", "own"]
    );
}

#[test]
fn an_ancestor_config_with_a_yaml_error_is_named() {
    let (_directory, root) = write_tree(&[
        ROOT_FILES[0],
        ROOT_FILES[1],
        ("apps/seampact.config.yaml", "targets: [\n"),
    ]);
    let problems = refused(read_tree_app(&root, "apps/api"));

    assert_eq!(problems[0].code, "config.yaml.syntax");
    assert!(
        problems[0]
            .location
            .as_deref()
            .is_some_and(|at| at.contains("apps/seampact.config.yaml"))
    );
}

#[test]
fn the_search_for_a_root_stops_at_a_git_directory() {
    let (_directory, root) = write_tree(&[
        ROOT_FILES[0],
        ROOT_FILES[1],
        ("apps/.git/HEAD", "ref: refs/heads/main\n"),
    ]);
    let config = read_config(read_tree_app(&root, "apps/api"));

    assert_eq!(
        config
            .sources
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["own"]
    );
    assert!(matches!(
        read_tree_app(&root, "apps/api"),
        ReadAppConfigOutcome::Read(_)
    ));
}
