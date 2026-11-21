//! The local package sources of an app directory.

#![allow(
    clippy::unwrap_used,
    clippy::panic,
    reason = "test code: a failed setup is the failed test"
)]

mod support;

use std::fs;

use seampact_bundle::{LocalPackageReason, LocalPackageSource, find_local_package_sources};
use support::scratch_directory;

#[test]
fn a_local_spec_wins_over_the_installed_path() {
    let app = scratch_directory("local-spec");

    fs::write(
        app.join("package.json"),
        r#"{"dependencies":{"a":"file:../a","b":"^1.0.0"},"devDependencies":{"a":"^2.0.0","c":"./c"}}"#,
    )
    .unwrap();

    let found = find_local_package_sources(&app, &["c".to_owned(), "a".to_owned(), "b".to_owned()])
        .unwrap();

    assert_eq!(
        found,
        [
            LocalPackageSource {
                package: "c".to_owned(),
                reason: LocalPackageReason::Spec("./c".to_owned())
            },
            LocalPackageSource {
                package: "a".to_owned(),
                reason: LocalPackageReason::Spec("file:../a".to_owned())
            },
        ]
    );
}

#[cfg(unix)]
#[test]
fn a_link_out_of_node_modules_is_local_and_a_copy_is_not() {
    let app = scratch_directory("local-link");
    let outside = scratch_directory("local-link-outside");
    let modules = app.join("node_modules");

    fs::create_dir_all(modules.join("copied")).unwrap();
    fs::write(modules.join("copied/package.json"), "{}").unwrap();
    fs::write(outside.join("package.json"), "{}").unwrap();
    std::os::unix::fs::symlink(&outside, modules.join("linked")).unwrap();
    fs::write(
        app.join("package.json"),
        r#"{"dependencies":{"linked":"1.0.0"}}"#,
    )
    .unwrap();

    let found =
        find_local_package_sources(&app, &["copied".to_owned(), "linked".to_owned()]).unwrap();

    assert_eq!(found.len(), 1, "found {found:?}");
    assert_eq!(found[0].package, "linked");
    assert!(matches!(found[0].reason, LocalPackageReason::RealPath(_)));
}

#[test]
fn a_package_manifest_that_is_not_json_stops_the_search() {
    let app = scratch_directory("local-broken");

    fs::write(app.join("package.json"), "{").unwrap();

    assert!(find_local_package_sources(&app, &["a".to_owned()]).is_err());
}
