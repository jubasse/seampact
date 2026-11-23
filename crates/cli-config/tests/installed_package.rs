//! `find_package_manager`, `install_command`, `install_fix` and `read_installed_version` on the
//! cases of the TypeScript `package-manager.test.ts` and `installed-version.test.ts`.

#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::type_complexity,
    reason = "test code: a failed lookup is the failed test"
)]

mod support;

use seampact_cli_config::{
    DependencyKind, InstalledPackageRole, InstalledVersion, InstalledVersionOutcome,
    PackageManager, find_package_manager, install_command, install_fix, read_installed_version,
};
use support::write_tree;

const WHERE: &str = "entry 'server'";

#[test]
fn each_lockfile_names_its_manager() {
    for (lockfile, manager) in [
        ("pnpm-lock.yaml", PackageManager::Pnpm),
        ("yarn.lock", PackageManager::Yarn),
        ("bun.lock", PackageManager::Bun),
        ("bun.lockb", PackageManager::Bun),
        ("package-lock.json", PackageManager::Npm),
    ] {
        let (_directory, root) = write_tree(&[(lockfile, "")]);

        assert_eq!(
            find_package_manager(&root).expect("a manager"),
            manager,
            "{lockfile}"
        );
    }
}

#[test]
fn the_package_manager_field_names_the_manager_without_a_lockfile() {
    let (_directory, root) =
        write_tree(&[("package.json", r#"{ "packageManager": "yarn@4.1.0" }"#)]);

    assert_eq!(
        find_package_manager(&root).expect("a manager"),
        PackageManager::Yarn
    );
}

#[test]
fn a_lockfile_wins_over_the_field_of_its_directory() {
    let (_directory, root) = write_tree(&[
        ("pnpm-lock.yaml", ""),
        ("package.json", r#"{ "packageManager": "yarn@4.1.0" }"#),
    ]);

    assert_eq!(
        find_package_manager(&root).expect("a manager"),
        PackageManager::Pnpm
    );
}

#[test]
fn a_field_naming_no_known_manager_is_ignored_and_the_nearest_lockfile_wins() {
    let (_directory, root) = write_tree(&[
        ("package.json", r#"{ "packageManager": "deno@1.0.0" }"#),
        ("pnpm-lock.yaml", ""),
        ("app/package-lock.json", ""),
        ("other/x", ""),
    ]);

    assert_eq!(
        find_package_manager(&root.join("other")).expect("a manager"),
        PackageManager::Pnpm
    );
    assert_eq!(
        find_package_manager(&root.join("app")).expect("a manager"),
        PackageManager::Npm
    );
}

#[test]
fn a_dev_and_a_runtime_dependency_use_their_own_command() {
    let (_directory, root) = write_tree(&[("pnpm-lock.yaml", "")]);

    assert_eq!(
        install_command(&root, "@seampact/codegen-zod", DependencyKind::Dev).as_deref(),
        Ok("pnpm add -D @seampact/codegen-zod")
    );
    assert_eq!(
        install_command(&root, "zod", DependencyKind::Runtime).as_deref(),
        Ok("pnpm add zod")
    );
}

#[test]
fn the_install_fix_says_why_no_command_can_be_told_for_a_package_json_that_is_not_json() {
    let (_directory, root) = write_tree(&[("package.json", "{ not json")]);
    let fix = install_fix(&root, "zod", DependencyKind::Runtime).expect("a fix");

    assert!(fix.contains("with your package manager"), "{fix}");
    assert!(fix.contains("is not valid JSON"), "{fix}");
}

#[test]
fn the_install_fix_names_the_command_otherwise() {
    let (_directory, root) = write_tree(&[("bun.lock", "")]);

    assert_eq!(
        install_fix(&root, "zod", DependencyKind::Runtime).as_deref(),
        Ok("Install it: `bun add zod`.")
    );
}

fn installed(outcome: InstalledVersionOutcome) -> InstalledVersion {
    match outcome {
        InstalledVersionOutcome::Installed(installed) => installed,
        InstalledVersionOutcome::Refused(problem) => panic!("refused: {problem:?}"),
    }
}

#[test]
fn a_package_json_the_exports_hide_is_read() {
    let (_directory, root) = write_tree(&[
        ("app/seampact.config.yaml", ""),
        (
            "app/node_modules/web-framework/package.json",
            r#"{"name":"web-framework","version":"5.2.1","exports":{".":"./index.js"}}"#,
        ),
    ]);
    let outcome = read_installed_version(
        &root.join("app"),
        "web-framework",
        InstalledPackageRole::Framework,
        WHERE,
    )
    .expect("an outcome");

    assert_eq!(
        installed(outcome),
        InstalledVersion {
            package_name: "web-framework".to_owned(),
            version: "5.2.1".to_owned(),
            major: 5
        }
    );
}

#[test]
fn a_package_hoisted_above_the_app_counts_a_pre_release_by_its_major() {
    let (_directory, root) = write_tree(&[
        ("apps/web/seampact.config.yaml", ""),
        (
            "node_modules/@acme/framework/package.json",
            r#"{"version":"6.0.0-beta.2"}"#,
        ),
    ]);
    let outcome = read_installed_version(
        &root.join("apps/web"),
        "@acme/framework",
        InstalledPackageRole::Framework,
        WHERE,
    )
    .expect("an outcome");
    let found = installed(outcome);

    assert_eq!((found.version.as_str(), found.major), ("6.0.0-beta.2", 6));
}

#[test]
fn a_missing_package_is_refused_with_the_runtime_install_command() {
    let (_directory, root) = write_tree(&[("seampact.config.yaml", ""), ("pnpm-lock.yaml", "")]);
    let outcome = read_installed_version(
        &root,
        "web-framework-absent",
        InstalledPackageRole::Framework,
        WHERE,
    )
    .expect("an outcome");
    let InstalledVersionOutcome::Refused(problem) = outcome else {
        panic!("installed");
    };

    assert_eq!(problem.code, "config.matrix.framework-missing");
    assert_eq!(
        problem.message,
        format!(
            "The framework package 'web-framework-absent' is not installed in the project of the entry's output directory ({root}), so its version cannot be checked against the compatibility matrix; the generated code imports it."
        )
    );
    assert_eq!(problem.fix, "Install it: `pnpm add web-framework-absent`.");
    assert_eq!(problem.location.as_deref(), Some(WHERE));
}

#[test]
fn a_version_the_cli_cannot_read_is_refused_naming_the_role() {
    let (_directory, root) = write_tree(&[
        ("seampact.config.yaml", ""),
        (
            "node_modules/schema-library/package.json",
            r#"{"version":"latest"}"#,
        ),
    ]);
    let outcome = read_installed_version(
        &root,
        "schema-library",
        InstalledPackageRole::ValidatorLibrary,
        WHERE,
    )
    .expect("an outcome");
    let InstalledVersionOutcome::Refused(problem) = outcome else {
        panic!("installed");
    };

    assert_eq!(problem.code, "config.matrix.version-unreadable");
    assert_eq!(
        problem.message,
        format!(
            "The installed validator library 'schema-library' has no version the CLI can read: {root}/node_modules/schema-library/package.json declares no `version` of the form <major>.<minor>.<patch>."
        )
    );
    assert_eq!(
        problem.fix,
        "Reinstall 'schema-library' with your package manager."
    );
}

#[test]
fn a_package_json_that_is_not_json_is_refused_with_the_parser_message() {
    let (_directory, root) = write_tree(&[("node_modules/x/package.json", "{ not json")]);
    let outcome = read_installed_version(&root, "x", InstalledPackageRole::Library, WHERE)
        .expect("an outcome");
    let InstalledVersionOutcome::Refused(problem) = outcome else {
        panic!("installed");
    };

    assert!(
        problem
            .message
            .contains("is not valid JSON (Expected property name"),
        "{}",
        problem.message
    );
}

#[test]
fn the_major_pattern_edges() {
    for (version, expected) in [
        ("v5.0.0", Some(5)),
        ("0.162.3", Some(0)),
        ("05.1.0", None),
        ("5", None),
        ("5-beta", None),
        ("\u{663}.0.0", None),
        ("9007199254740992.0.0", Some(9_007_199_254_740_992)),
        ("9007199254740993.0.0", None),
    ] {
        let (_directory, root) = write_tree(&[(
            "node_modules/x/package.json",
            &format!(r#"{{"version":"{version}"}}"#),
        )]);
        let outcome = read_installed_version(&root, "x", InstalledPackageRole::Library, WHERE)
            .expect("an outcome");
        let major = match outcome {
            InstalledVersionOutcome::Installed(found) => Some(found.major),
            InstalledVersionOutcome::Refused(_) => None,
        };

        assert_eq!(major, expected, "version {version:?}");
    }
}

#[test]
fn a_plug_n_play_project_is_refused_by_name() {
    let (_directory, root) = write_tree(&[
        ("app/seampact.config.yaml", ""),
        (".pnp.cjs", ""),
        ("yarn.lock", ""),
    ]);
    let app = root.join("app");
    let outcome = read_installed_version(
        &app,
        "web-framework",
        InstalledPackageRole::Framework,
        WHERE,
    )
    .expect("an outcome");
    let InstalledVersionOutcome::Refused(problem) = outcome else {
        panic!("installed");
    };

    assert_eq!(problem.code, "config.matrix.pnp-unsupported");
    assert_eq!(
        problem.message,
        format!(
            "The project around {app} installs its packages with Yarn Plug'n'Play ({root}/.pnp.cjs), which the CLI cannot read the version of 'web-framework' from."
        )
    );
}
