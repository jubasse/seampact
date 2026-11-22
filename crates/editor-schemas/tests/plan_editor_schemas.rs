//! Where the editor schemas go: the default directory, a configured one, and the refusals.

use std::fs;
use std::os::unix::fs::symlink;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_editor_schemas::{
    EditorSchemasPlanOutcome, EditorSchemasSource, plan_editor_schemas, write_editor_schemas,
};
use seampact_load::FsReader;
use tempfile::TempDir;

type TestResult = Result<(), Box<dyn std::error::Error>>;

const API_FILE: &str = "api:\n  name: demo\n  version: 1.0.0\n";

fn workspace(config: &str) -> Result<(TempDir, Utf8PathBuf), Box<dyn std::error::Error>> {
    let temporary = TempDir::new()?;
    let root = Utf8PathBuf::from_path_buf(fs::canonicalize(temporary.path())?)
        .map_err(|path| format!("{} is not UTF-8", path.display()))?;

    fs::write(
        root.join("workspace.yaml"),
        format!("workspace:\n{config}  apis:\n    demo: ./api.yaml\n"),
    )?;
    fs::write(root.join("api.yaml"), API_FILE)?;

    Ok((temporary, root))
}

fn plan(root: &Utf8Path) -> Result<EditorSchemasPlanOutcome, Box<dyn std::error::Error>> {
    let reader = FsReader::new(root)?;

    Ok(plan_editor_schemas(&EditorSchemasSource {
        name: "demo",
        directory: root,
        entry: "workspace.yaml",
        reader: &reader,
        declarations: &[],
    })?)
}

fn refusal_message(outcome: EditorSchemasPlanOutcome) -> Result<String, String> {
    match outcome {
        EditorSchemasPlanOutcome::Refused(problem) => {
            assert_eq!(problem.code, "compile.editor-schemas.outside");

            Ok(problem.message)
        }
        EditorSchemasPlanOutcome::Planned(_) => Err("the plan was not refused".to_owned()),
    }
}

#[test]
fn the_default_directory_is_planned_and_written() -> TestResult {
    let (_keep, root) = workspace("")?;
    let EditorSchemasPlanOutcome::Planned(plan) = plan(&root)? else {
        return Err("the default directory was refused".into());
    };

    assert_eq!(plan.directory, root.join(".seampact/schemas"));
    assert_eq!(write_editor_schemas(&plan)?, plan.files.len());
    assert!(root.join(".seampact/schemas/api.schema.json").is_file());

    Ok(())
}

#[test]
fn a_directory_outside_the_root_is_refused() -> TestResult {
    for configured in ["../elsewhere", "/tmp/elsewhere", "."] {
        let (_keep, root) = workspace(&format!("  editorSchemas: {configured}\n"))?;
        let message = refusal_message(plan(&root)?)?;

        assert!(
            message.contains("which is not a directory inside the workspace root"),
            "{configured}: {message}"
        );
    }

    Ok(())
}

#[test]
fn a_symlinked_directory_leading_outside_is_refused() -> TestResult {
    let (_keep, root) = workspace("  editorSchemas: linked/schemas\n")?;
    let outside = TempDir::new()?;

    symlink(outside.path(), root.join("linked"))?;

    let message = refusal_message(plan(&root)?)?;

    assert!(
        message.contains("resolves through a symbolic link"),
        "{message}"
    );

    Ok(())
}

#[test]
fn a_symlinked_schema_file_is_refused() -> TestResult {
    let (_keep, root) = workspace("")?;
    let directory = root.join(".seampact/schemas");

    fs::create_dir_all(&directory)?;
    symlink(root.join("api.yaml"), directory.join("api.schema.json"))?;

    let message = refusal_message(plan(&root)?)?;

    assert!(message.contains("is a symbolic link"), "{message}");

    Ok(())
}

#[test]
fn a_symlinked_temporary_schema_file_is_refused_and_its_target_left_alone() -> TestResult {
    let (_keep, root) = workspace("")?;
    let directory = root.join(".seampact/schemas");
    let precious = root.join("precious.txt");

    fs::create_dir_all(&directory)?;
    fs::write(&precious, "PRECIOUS")?;
    symlink(&precious, directory.join("api.schema.json.tmp"))?;

    let message = refusal_message(plan(&root)?)?;

    assert!(message.contains("is a symbolic link"), "{message}");
    assert_eq!(fs::read_to_string(&precious)?, "PRECIOUS");

    Ok(())
}
