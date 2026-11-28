//! The public API of `seampact-paths`: output path checks, clashes and untrusted entries.

use seampact_paths::{
    OutputPathClash, OutputPathSet, ParseOutputPathError, RelativeOutputPath, UnsafePathReason,
    untrusted_entry_problem,
};

type TestResult = Result<(), ParseOutputPathError>;

fn reason_of(path: &str) -> Option<UnsafePathReason> {
    RelativeOutputPath::try_new(path)
        .err()
        .map(|error| error.reason())
}

fn path(text: &str) -> Result<RelativeOutputPath, ParseOutputPathError> {
    RelativeOutputPath::try_new(text)
}

fn clashes(paths: &[&str]) -> Result<Vec<Option<String>>, ParseOutputPathError> {
    let mut set = OutputPathSet::new();

    paths
        .iter()
        .map(|each| Ok(set.insert(&path(each)?).map(|clash| clash.to_string())))
        .collect()
}

#[test]
fn a_relative_posix_path_inside_its_root_is_accepted_as_written() -> TestResult {
    for accepted in ["a.ts", "src/api/client.ts", ".gitignore", "a..b/c", "1:/a"] {
        let checked = path(accepted)?;

        assert_eq!(checked.as_str(), accepted, "path {accepted:?}");
        assert_eq!(checked.as_path().as_str(), accepted, "path {accepted:?}");
    }

    Ok(())
}

#[test]
fn each_unsafe_path_is_refused_with_its_reason() {
    for (refused, reason) in [
        ("", UnsafePathReason::Empty),
        ("a\\b.ts", UnsafePathReason::Backslash),
        ("/etc/passwd", UnsafePathReason::AbsolutePrefix),
        ("C:/a.ts", UnsafePathReason::AbsolutePrefix),
        ("c:a.ts", UnsafePathReason::AbsolutePrefix),
        ("a\0.ts", UnsafePathReason::Nul),
        ("a//b.ts", UnsafePathReason::EmptyOrDotSegment),
        ("a/./b.ts", UnsafePathReason::EmptyOrDotSegment),
        ("../a.ts", UnsafePathReason::EmptyOrDotSegment),
        ("a/..", UnsafePathReason::EmptyOrDotSegment),
        ("a/", UnsafePathReason::EmptyOrDotSegment),
        (".", UnsafePathReason::EmptyOrDotSegment),
    ] {
        assert_eq!(reason_of(refused), Some(reason), "path {refused:?}");
    }
}

#[test]
fn the_refusal_keeps_the_path_and_words_the_writer_reason() {
    let error = RelativeOutputPath::try_new("../a.ts").unwrap_err();

    assert_eq!(error.path(), "../a.ts");
    assert_eq!(
        error.reason().to_string(),
        "it has an empty, '.' or '..' segment"
    );
}

#[test]
fn an_output_path_names_a_backslash_before_a_nul_and_an_entry_the_reverse() {
    let both = "/a\\\0";

    assert_eq!(reason_of(both), Some(UnsafePathReason::Backslash));
    assert_eq!(untrusted_entry_problem(both), Some(UnsafePathReason::Nul));
    assert_eq!(
        untrusted_entry_problem("/a\\"),
        Some(UnsafePathReason::Backslash)
    );
    assert_eq!(reason_of("/a\0"), Some(UnsafePathReason::AbsolutePrefix));
    assert_eq!(untrusted_entry_problem("/a\0"), Some(UnsafePathReason::Nul));
}

#[test]
fn an_untrusted_entry_passes_the_rules_an_output_path_passes() {
    for (entry, problem) in [
        ("sources/a.yaml", None),
        ("", Some(UnsafePathReason::Empty)),
        ("C:x", Some(UnsafePathReason::AbsolutePrefix)),
        ("ir/../x", Some(UnsafePathReason::EmptyOrDotSegment)),
    ] {
        assert_eq!(untrusted_entry_problem(entry), problem, "entry {entry:?}");
    }
}

#[test]
fn the_file_name_and_directories_come_from_the_segments() -> TestResult {
    let nested = path("a/b/c.ts")?;
    let flat = path("c.ts")?;

    assert_eq!(nested.file_name(), "c.ts");
    assert_eq!(nested.directories().collect::<Vec<_>>(), ["a", "a/b"]);
    assert_eq!(flat.file_name(), "c.ts");
    assert_eq!(flat.directories().count(), 0);

    Ok(())
}

#[test]
fn paths_sort_by_utf16_code_units_not_code_points() -> TestResult {
    let mut sorted = [path("\u{FFFF}.ts")?, path("\u{1F600}.ts")?, path("a.ts")?];

    sorted.sort();

    let texts: Vec<&str> = sorted.iter().map(RelativeOutputPath::as_str).collect();

    assert_eq!(texts, ["a.ts", "\u{1F600}.ts", "\u{FFFF}.ts"]);

    Ok(())
}

#[test]
fn distinct_paths_do_not_clash() -> TestResult {
    assert_eq!(
        clashes(&["a/b.ts", "a/c.ts", "b.ts", "a/d/e.ts"])?,
        [None, None, None, None]
    );

    Ok(())
}

#[test]
fn each_clash_is_worded_as_the_writer_words_it() -> TestResult {
    assert_eq!(
        clashes(&["a.ts", "a.ts", "A.TS", "a.ts/x", "src/x.ts", "SRC/y.ts", "src"])?,
        [
            None,
            Some("it is generated twice".to_owned()),
            Some("it differs only by letter case from 'a.ts'".to_owned()),
            Some("its directory 'a.ts' is also the file 'a.ts'".to_owned()),
            None,
            Some(
                "its directory 'SRC' differs only by letter case from the directory 'src' of an earlier path"
                    .to_owned()
            ),
            Some("it is a file, and an earlier path uses 'src' as a directory".to_owned()),
        ]
    );

    Ok(())
}

#[test]
fn composed_and_decomposed_spellings_are_two_paths() -> TestResult {
    let mut set = OutputPathSet::new();
    let composed = path("caf\u{E9}/a.ts")?;
    let decomposed_file = path("cafe\u{301}/a.ts")?;

    assert_eq!(set.insert(&composed), None);
    assert_eq!(set.insert(&decomposed_file), None);

    Ok(())
}

#[test]
fn a_clashing_path_is_remembered_and_the_first_spelling_is_named() -> TestResult {
    assert_eq!(
        clashes(&["Dir/a.ts", "dir/b.ts", "DIR/c.ts", "dir"])?,
        [
            None,
            Some(
                "its directory 'dir' differs only by letter case from the directory 'Dir' of an earlier path"
                    .to_owned()
            ),
            Some(
                "its directory 'DIR' differs only by letter case from the directory 'Dir' of an earlier path"
                    .to_owned()
            ),
            Some("it is a file, and an earlier path uses 'Dir' as a directory".to_owned()),
        ]
    );

    Ok(())
}
