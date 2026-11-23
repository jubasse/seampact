//! The write of a target's files: normalised bytes, a manifest, and every refusal before a write.

use std::fs;

use camino::Utf8Path;
use seampact_writer::{
    HandEditPolicy, WriteStop, WrittenFiles, plan_generated_write, write_generated_files,
};

use crate::support::{file, read, temporary_directory};

const MANIFEST: &str = ".seampact-manifest.json";

fn written(
    out: &Utf8Path,
    owner: &str,
    files: &[(&str, &str)],
    policy: HandEditPolicy,
) -> WrittenFiles {
    let generated: Vec<_> = files.iter().map(|(path, text)| file(path, text)).collect();

    match write_generated_files(out, owner, generated, policy) {
        Ok(done) => done,
        Err(stop) => panic!("stopped: {stop:?}"),
    }
}

fn refusals(
    out: &Utf8Path,
    owner: &str,
    files: &[(&str, &str)],
    policy: HandEditPolicy,
) -> Vec<(String, String)> {
    let generated: Vec<_> = files.iter().map(|(path, text)| file(path, text)).collect();

    match write_generated_files(out, owner, generated, policy) {
        Err(WriteStop::Refused(refused)) => refused
            .0
            .into_iter()
            .map(|refusal| (refusal.code, refusal.message))
            .collect(),
        Err(WriteStop::Failed(error)) => panic!("failed: {error}"),
        Ok(done) => panic!("written: {done:?}"),
    }
}

fn manifest_sha256_of(out: &Utf8Path, path: &str) -> String {
    let manifest: serde_json::Value =
        serde_json::from_str(&read(&out.join(MANIFEST))).expect("JSON");

    manifest["files"]
        .as_array()
        .expect("files")
        .iter()
        .find(|entry| entry["path"] == path)
        .and_then(|entry| entry["sha256"].as_str())
        .expect("an entry")
        .to_owned()
}

#[test]
fn bytes_are_written_without_bom_with_lf_and_one_final_newline() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    written(
        &out,
        "node",
        &[("a.ts", "\u{feff}one\r\ntwo\rthree"), ("b/c.ts", "x\n")],
        HandEditPolicy::Refuse,
    );

    assert_eq!(read(&out.join("a.ts")), "one\ntwo\nthree\n");
    assert_eq!(read(&out.join("b/c.ts")), "x\n");
    assert_eq!(
        manifest_sha256_of(&out, "a.ts"),
        "b6285c57e8797db5d4c51c80d6f11938afda9b11c6a003549709189e9b4b92a2"
    );
}

#[test]
fn a_second_run_keeps_unchanged_files_and_removes_stale_ones_with_their_empty_directories() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    written(
        &out,
        "node",
        &[("a.ts", "a"), ("old/deep/b.ts", "b")],
        HandEditPolicy::Refuse,
    );

    let second = written(
        &out,
        "node",
        &[("a.ts", "a"), ("c.ts", "c")],
        HandEditPolicy::Refuse,
    );

    assert_eq!(second.unchanged, ["a.ts"]);
    assert_eq!(second.written, ["c.ts"]);
    assert_eq!(second.removed, ["old/deep/b.ts"]);
    assert!(!out.join("old").exists());
}

#[test]
fn a_hand_edited_file_is_refused_unless_the_write_overwrites() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    written(&out, "node", &[("a.ts", "a")], HandEditPolicy::Refuse);
    fs::write(out.join("a.ts"), "edited\n").expect("an edit");

    let problems = refusals(&out, "node", &[("a.ts", "a")], HandEditPolicy::Refuse);

    assert_eq!(problems[0].0, "writer.file.edited");
    assert_eq!(read(&out.join("a.ts")), "edited\n");

    let done = written(&out, "node", &[("a.ts", "a")], HandEditPolicy::Overwrite);

    assert_eq!(done.written, ["a.ts"]);
    assert_eq!(read(&out.join("a.ts")), "a\n");
}

#[test]
fn a_file_the_writer_did_not_generate_is_never_overwritten() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    fs::create_dir_all(&out).expect("a directory");
    fs::write(out.join("mine.ts"), "mine").expect("a file");

    let problems = refusals(&out, "node", &[("mine.ts", "x")], HandEditPolicy::Overwrite);

    assert_eq!(problems[0].0, "writer.file.not-generated");
    assert_eq!(read(&out.join("mine.ts")), "mine");
}

#[test]
fn another_owner_and_an_unreadable_manifest_are_refused_and_nothing_is_written() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    written(&out, "node", &[("a.ts", "a")], HandEditPolicy::Refuse);

    let other = refusals(&out, "python", &[("b.py", "b")], HandEditPolicy::Refuse);

    assert_eq!(other[0].0, "writer.manifest.other-owner");
    assert!(!out.join("b.py").exists());

    fs::write(out.join(MANIFEST), "{not json").expect("a broken manifest");

    let unreadable = refusals(&out, "node", &[("b.ts", "b")], HandEditPolicy::Refuse);

    assert_eq!(unreadable[0].0, "writer.manifest.invalid");
    assert!(
        unreadable[0].1.contains("cannot be read: it is not JSON ("),
        "{}",
        unreadable[0].1
    );
    assert!(!out.join("b.ts").exists());
}

#[test]
fn a_stale_file_renamed_only_by_case_gets_its_own_message_and_fix() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    written(&out, "node", &[("Readme.ts", "a")], HandEditPolicy::Refuse);
    fs::remove_file(out.join("Readme.ts")).expect("a removal");
    fs::write(out.join("README.ts"), "x").expect("a file");

    let problems = refusals(&out, "node", &[("README.ts", "a")], HandEditPolicy::Refuse);

    assert_eq!(problems[0].0, "writer.file.not-generated");
    assert!(
        problems[0]
            .1
            .contains("the previous run generated 'Readme.ts'"),
        "{}",
        problems[0].1
    );
}

#[test]
fn a_1x_manifest_is_rewritten_without_a_hand_edit_refusal() {
    let (_guard, root) = temporary_directory();
    let out = root.join("out");

    written(&out, "node", &[("a.ts", "a")], HandEditPolicy::Refuse);

    let sha256 = manifest_sha256_of(&out, "a.ts");

    fs::write(
        out.join(MANIFEST),
        format!(r#"{{"owner":"node","files":[{{"path":"a.ts","sha256":"{sha256}"}}]}}"#),
    )
    .expect("a 1.x manifest");

    let done = written(&out, "node", &[("a.ts", "a")], HandEditPolicy::Refuse);

    assert_eq!(done.unchanged, ["a.ts"]);
    assert!(read(&out.join(MANIFEST)).contains("\"version\": 2"));
}

#[cfg(unix)]
mod links {
    use std::os::unix::fs::symlink;

    use super::*;

    #[test]
    fn a_link_in_place_of_the_manifest_is_refused_and_nothing_is_written() {
        let (_guard, root) = temporary_directory();
        let out = root.join("out");

        fs::create_dir_all(&out).expect("a directory");
        symlink(root.join("elsewhere"), out.join(MANIFEST)).expect("a link");

        let problems = refusals(&out, "node", &[("a.ts", "a")], HandEditPolicy::Refuse);

        assert_eq!(problems[0].0, "writer.manifest.not-regular");
        assert!(!out.join("a.ts").exists());
    }

    #[test]
    fn a_directory_that_links_outside_the_output_directory_is_refused() {
        let (_guard, root) = temporary_directory();
        let out = root.join("out");
        let outside = root.join("outside");

        fs::create_dir_all(&out).expect("a directory");
        fs::create_dir_all(&outside).expect("a directory");
        symlink(&outside, out.join("linked")).expect("a link");

        let problems = refusals(
            &out,
            "node",
            &[("linked/a.ts", "a")],
            HandEditPolicy::Refuse,
        );

        assert_eq!(problems[0].0, "writer.path.outside");
        assert!(!outside.join("a.ts").exists());
    }

    #[test]
    fn a_link_in_place_of_a_generated_file_is_refused() {
        let (_guard, root) = temporary_directory();
        let out = root.join("out");

        fs::create_dir_all(&out).expect("a directory");
        fs::write(root.join("target.ts"), "t").expect("a file");
        symlink(root.join("target.ts"), out.join("a.ts")).expect("a link");

        let problems = refusals(&out, "node", &[("a.ts", "a")], HandEditPolicy::Overwrite);

        assert_eq!(problems[0].0, "writer.file.not-generated");
        assert_eq!(read(&root.join("target.ts")), "t");
    }

    #[test]
    fn an_output_directory_below_a_link_is_judged_by_its_real_path() {
        let (_guard, root) = temporary_directory();
        let real = root.join("real");

        fs::create_dir_all(&real).expect("a directory");
        symlink(&real, root.join("via")).expect("a link");

        let plan = plan_generated_write(
            &root.join("via/new"),
            "node",
            vec![file("a.ts", "a")],
            HandEditPolicy::Refuse,
        );

        assert!(plan.is_ok(), "{plan:?}");
    }
}
