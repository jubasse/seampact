//! The manifest of an output directory: its text, its reading and what it refuses.

use crate::support::{read, temporary_directory};
use seampact_writer::{ManifestEntry, ManifestRead, read_manifest, serialize_manifest};

const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn entry(path: &str) -> ManifestEntry {
    ManifestEntry {
        path: path.to_owned(),
        source: HASH.to_owned(),
        sha256: HASH.to_owned(),
        formatter: None,
    }
}

fn read_text(text: &str) -> ManifestRead {
    let (_guard, root) = temporary_directory();

    std::fs::write(root.join(".seampact-manifest.json"), text).expect("a written manifest");

    read_manifest(&root).expect("a readable manifest")
}

fn invalid_reason(text: &str) -> String {
    match read_text(text) {
        ManifestRead::Invalid { reason } => reason,
        ManifestRead::Read { .. } => panic!("the manifest {text} was read"),
    }
}

#[test]
fn a_manifest_lists_its_members_in_javascript_key_order_and_its_files_in_utf16_order() {
    let mut with_formatter = entry("a");

    with_formatter.formatter = Some("biome".to_owned());

    let text = serialize_manifest(
        "openapi",
        &[entry("\u{ff5e}"), entry("\u{10000}"), with_formatter],
    );

    let expected = format!(
        "{{\n  \"version\": 2,\n  \"owner\": \"openapi\",\n  \"files\": [\n    {{\n      \"path\": \"a\",\n      \"source\": \"{HASH}\",\n      \"sha256\": \"{HASH}\",\n      \"formatter\": \"biome\"\n    }},\n    {{\n      \"path\": \"\u{10000}\",\n      \"source\": \"{HASH}\",\n      \"sha256\": \"{HASH}\"\n    }},\n    {{\n      \"path\": \"\u{ff5e}\",\n      \"source\": \"{HASH}\",\n      \"sha256\": \"{HASH}\"\n    }}\n  ]\n}}\n"
    );

    assert_eq!(text, expected);
}

#[test]
fn a_written_manifest_reads_back_and_a_missing_one_is_empty() {
    let (_guard, root) = temporary_directory();

    assert_eq!(
        read_manifest(&root).expect("a missing manifest"),
        ManifestRead::Read {
            owner: None,
            entries: Vec::new()
        }
    );

    let entries = [entry("a.ts"), entry("b/c.ts")];

    std::fs::write(
        root.join(".seampact-manifest.json"),
        serialize_manifest("node", &entries),
    )
    .expect("a written manifest");

    assert_eq!(
        read_manifest(&root).expect("a readable manifest"),
        ManifestRead::Read {
            owner: Some("node".to_owned()),
            entries: entries.to_vec()
        }
    );
    assert!(read(&root.join(".seampact-manifest.json")).ends_with("}\n"));
}

#[test]
fn a_manifest_without_version_is_read_as_1x_with_source_equal_to_sha256() {
    let text = format!(r#"{{"owner":"node","files":[{{"path":"a.ts","sha256":"{HASH}"}}]}}"#);

    assert_eq!(
        read_text(&text),
        ManifestRead::Read {
            owner: Some("node".to_owned()),
            entries: vec![entry("a.ts")]
        }
    );
}

#[test]
fn the_version_is_read_as_a_javascript_number() {
    let text = format!(
        r#"{{"version":2.0,"owner":"node","files":[{{"path":"a.ts","source":"{HASH}","sha256":"{HASH}"}}]}}"#
    );

    assert!(matches!(read_text(&text), ManifestRead::Read { .. }));
    assert_eq!(
        invalid_reason(r#"{"version":3,"owner":"n","files":[]}"#),
        "it is version 3, which this seampact does not read"
    );
    assert_eq!(
        invalid_reason(r#"{"version":"2","owner":"n","files":[]}"#),
        "it is version 2, which this seampact does not read"
    );
}

#[test]
fn a_malformed_manifest_is_refused_with_its_reason() {
    let upper = HASH.to_uppercase();
    let newline = format!("{HASH}\\n");
    let cases: [(String, &str); 9] = [
        ("[]".to_owned(), "it has no `files` array"),
        (r#"{"owner":"n"}"#.to_owned(), "it has no `files` array"),
        (r#"{"files":[]}"#.to_owned(), "it has no `owner` target id"),
        (
            r#"{"owner":"n","files":[1]}"#.to_owned(),
            "an entry is not `{ path, sha256 }` strings",
        ),
        (
            format!(r#"{{"owner":"n","files":[{{"path":"a","sha256":"{upper}"}}]}}"#),
            "the hash of 'a' is not a SHA-256 hex digest",
        ),
        (
            format!(r#"{{"owner":"n","files":[{{"path":"a","sha256":"{newline}"}}]}}"#),
            "the hash of 'a' is not a SHA-256 hex digest",
        ),
        (
            format!(
                r#"{{"owner":"n","files":[{{"path":"a","sha256":"{HASH}"}},{{"path":"a","sha256":"{HASH}"}}]}}"#
            ),
            "'a' is listed twice",
        ),
        (
            format!(r#"{{"owner":"n","files":[{{"path":"../a","sha256":"{HASH}"}}]}}"#),
            "the path '../a' is unsafe: it has an empty, '.' or '..' segment",
        ),
        (
            format!(r#"{{"version":2,"owner":"n","files":[{{"path":"a","sha256":"{HASH}"}}]}}"#),
            "an entry is not `{ path, source, sha256 }` strings with an optional `formatter` string",
        ),
    ];

    for (text, reason) in cases {
        assert_eq!(invalid_reason(&text), reason, "manifest {text}");
    }

    assert!(invalid_reason("{not json").starts_with("it is not JSON ("));
}

#[test]
fn a_link_in_place_of_the_manifest_is_invalid_and_not_followed() {
    let (_guard, root) = temporary_directory();

    std::os::unix::fs::symlink("/dev/zero", root.join(".seampact-manifest.json")).expect("a link");

    assert_eq!(
        read_manifest(&root).expect("an answer"),
        ManifestRead::Invalid {
            reason: "it is not a regular file".to_owned()
        }
    );
}

#[test]
fn a_manifest_above_four_mebibytes_is_invalid() {
    let (_guard, root) = temporary_directory();

    std::fs::write(
        root.join(".seampact-manifest.json"),
        vec![b' '; 5 * 1024 * 1024],
    )
    .expect("a large manifest");

    assert_eq!(
        read_manifest(&root).expect("an answer"),
        ManifestRead::Invalid {
            reason: "it is larger than 4194304 bytes".to_owned()
        }
    );
}
