//! The rows of PORTING.md section 2 the loader touches, on their edge values: UTF-16 order, JS key
//! order, `/` in paths and errors that are diagnostics.

use seampact_diagnostics::DiagnosticLayer;
use seampact_load::MemoryReader;

use super::harness::{owned, run, run_entry, run_on};

// U+10000 is the surrogate pair D800 DC00: it sorts before U+E000 in UTF-16 and after it in bytes.
const ASTRAL_FILE: &str = "\u{10000}.yaml";
const BMP_FILE: &str = "\u{E000}.yaml";

#[test]
fn the_files_read_are_sorted_by_utf16_code_units() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nkx: { $file: ./\u{E000}.yaml }\nky: { $file: ./\u{10000}.yaml }\nkz: { $file: ./b.yaml }\n",
        ),
        (BMP_FILE, "a: 1\n"),
        (ASTRAL_FILE, "a: 1\n"),
        ("b.yaml", "a: 1\n"),
    ]);

    assert_eq!(
        load.output.read_files,
        ["api.yaml", "b.yaml", ASTRAL_FILE, BMP_FILE]
    );
}

#[test]
fn the_diagnostics_are_sorted_by_file_in_utf16_code_units() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nkx: { $file: ./\u{E000}.yaml }\nky: { $file: ./\u{10000}.yaml }\n",
        ),
        (BMP_FILE, "flag: yes\n"),
        (ASTRAL_FILE, "flag: yes\n"),
    ]);
    let printed = load.printed();
    let files: Vec<&str> = printed
        .lines()
        .map(|line| line.split(':').next().unwrap_or_default())
        .collect();

    assert_eq!(load.rules(), ["yaml-boolean", "yaml-boolean"]);
    assert_eq!(files, [ASTRAL_FILE, BMP_FILE]);
}

#[test]
fn apis_load_in_javascript_key_order() {
    let load = run_entry(
        &[
            (
                "workspace.yaml",
                "workspace:\n  apis: { b: ./b.yaml, \"10\": ./10.yaml, \"9\": ./9.yaml, \"01\": ./01.yaml }\n",
            ),
            ("b.yaml", "api: { name: b }\n"),
            ("10.yaml", "api: { name: \"10\" }\n"),
            ("9.yaml", "api: { name: \"9\" }\n"),
            ("01.yaml", "api: { name: \"01\" }\n"),
        ],
        "workspace.yaml",
    );
    let names: Vec<&str> = load
        .output
        .workspace
        .apis
        .iter()
        .map(|api| api.name.as_str())
        .collect();

    load.assert_clean();
    assert_eq!(names, ["9", "10", "b", "01"]);
}

#[test]
fn paths_are_root_relative_with_forward_slashes() {
    let load = run(&[
        (
            "api.yaml",
            "api: { name: t }\nkx: { $file: ./a/./b/../c.md }\nky: { $file: a\\c.md }\n",
        ),
        ("a/c.md", "text\n"),
    ]);

    assert_eq!(load.rules(), ["path-backslash"]);
    assert_eq!(load.output.read_files, ["a/c.md", "api.yaml"]);
    assert_eq!(load.merged(0)["kx"], "text\n");
}

#[test]
fn a_missing_file_and_a_refused_path_are_diagnostics_not_failures() {
    let load = run(&[(
        "api.yaml",
        "api: { name: t }\nkx: { $file: ./gone.md }\nky: { $file: ../outside.md }\nkz: { $file: /abs.md }\n",
    )]);

    assert_eq!(
        load.rules(),
        ["file-missing", "path-escape", "path-absolute"]
    );
    assert_eq!(load.diagnostic(0).origin.layer, DiagnosticLayer::Api);
}

#[test]
fn a_load_over_an_empty_reader_and_a_reader_with_a_bom_agree_on_the_entry() {
    let plain = run_on(
        &MemoryReader::new(owned(&[("api.yaml", "api: { name: t }\n")])),
        "api.yaml",
    );
    let bom = run_on(
        &MemoryReader::new(owned(&[("api.yaml", "\u{FEFF}api: { name: t }\r\n")])),
        "api.yaml",
    );

    assert_eq!(bom.merged_text(0), plain.merged_text(0));
    assert_eq!(
        bom.api_location(0, "api#/api/name"),
        plain.api_location(0, "api#/api/name")
    );
}
