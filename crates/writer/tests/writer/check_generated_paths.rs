//! The path checks of a target's files: unsafe, duplicate, case-clashing and reserved paths.

use crate::support::file;
use seampact_target::GeneratedFile;
use seampact_writer::check_generated_paths;

fn refusal_messages(files: &[GeneratedFile]) -> Vec<String> {
    match check_generated_paths(files.to_vec()) {
        Err(refused) => refused
            .0
            .into_iter()
            .map(|refusal| refusal.message)
            .collect(),
        Ok(_) => Vec::new(),
    }
}

fn ready_paths(files: &[GeneratedFile]) -> Vec<String> {
    match check_generated_paths(files.to_vec()) {
        Ok(files) => files.into_iter().map(|file| file.path).collect(),
        Err(refused) => panic!("refused: {refused:?}"),
    }
}

#[test]
fn files_come_back_in_utf16_order_of_path() {
    // U+10000 is the surrogate pair D800 DC00: before U+FF5E by UTF-16 code unit, after it by code point.
    let files = [
        file("\u{10000}", ""),
        file("\u{ff5e}", ""),
        file("b", ""),
        file("a", ""),
    ];

    assert_eq!(ready_paths(&files), ["a", "b", "\u{10000}", "\u{ff5e}"]);
}

#[test]
fn an_unsafe_path_is_refused_by_name_and_never_clashes_with_a_later_one() {
    let messages = refusal_messages(&[file("a/../b", ""), file("a/../b", "")]);

    assert_eq!(
        messages,
        [
            "The target generated the path 'a/../b', and it has an empty, '.' or '..' segment.",
            "The target generated the path 'a/../b', and it has an empty, '.' or '..' segment.",
        ]
    );
}

#[test]
fn a_repeated_path_is_generated_twice_even_after_a_case_variant() {
    let messages = refusal_messages(&[file("A.ts", ""), file("a.ts", ""), file("A.ts", "")]);

    assert_eq!(
        messages,
        [
            "The target generated the path 'a.ts', and it differs only by letter case from 'A.ts'.",
            "The target generated the path 'A.ts', and it is generated twice.",
        ]
    );
}

#[test]
fn a_file_that_is_also_a_directory_and_directories_that_differ_by_case_are_refused() {
    let messages = refusal_messages(&[
        file("src", ""),
        file("src/a.ts", ""),
        file("Lib/a.ts", ""),
        file("lib/b.ts", ""),
    ]);

    assert_eq!(
        messages,
        [
            "The target generated the path 'src/a.ts', and its directory 'src' is also the file 'src'.",
            "The target generated the path 'lib/b.ts', and its directory 'lib' differs only by letter case from the directory 'Lib' of an earlier path.",
        ]
    );
}

#[test]
fn the_manifest_name_is_reserved_in_every_directory() {
    let messages = refusal_messages(&[file("nested/.seampact-manifest.json", "{}")]);

    assert_eq!(
        messages,
        [
            "The target generated the path 'nested/.seampact-manifest.json', and '.seampact-manifest.json' is the writer's manifest."
        ]
    );
}

#[test]
fn the_manifest_name_is_reserved_whatever_its_letter_case() {
    let messages = refusal_messages(&[file("nested/.Seampact-Manifest.JSON", "{}")]);

    assert_eq!(
        messages,
        [
            "The target generated the path 'nested/.Seampact-Manifest.JSON', and '.seampact-manifest.json' is the writer's manifest."
        ]
    );
}
