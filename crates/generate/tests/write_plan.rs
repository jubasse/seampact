//! The writes of a run: planned and checked, then committed with what each wrote printed.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::{CheckLevel, CliIo};
use seampact_generate::{
    EmittedAppDocument, GeneratedOutput, Stop, SweptDirectory, commit_writes, committable_writes,
    plan_writes,
};
use seampact_target::{GenerateWarning, GeneratedFile};
use seampact_writer::HandEditPolicy;

type TestResult<Value> = Result<Value, Box<dyn std::error::Error>>;

#[derive(Default)]
struct RecordingIo {
    stdout: String,
    stderr: String,
}

impl CliIo for RecordingIo {
    fn cwd(&self) -> &Utf8Path {
        Utf8Path::new("/")
    }

    fn stdout(&mut self, text: &str) {
        self.stdout.push_str(text);
    }

    fn stderr(&mut self, text: &str) {
        self.stderr.push_str(text);
    }

    fn environment_variable(&self, _name: &str) -> Option<String> {
        None
    }

    fn today(&self) -> String {
        "2000-01-01".to_owned()
    }
}

fn directory_of(temporary: &tempfile::TempDir) -> TestResult<Utf8PathBuf> {
    Ok(Utf8PathBuf::from_path_buf(temporary.path().to_path_buf())
        .map_err(|path| format!("not UTF-8: {}", path.display()))?)
}

fn output_in(root: &Utf8Path, contents: &str, warnings: Vec<GenerateWarning>) -> GeneratedOutput {
    GeneratedOutput {
        entry_id: "api".to_owned(),
        api: "tasks".to_owned(),
        root: root.to_path_buf(),
        files: vec![GeneratedFile {
            path: "a.json".to_owned(),
            contents: contents.to_owned(),
        }],
        warnings,
        level: CheckLevel::Error,
        app: None,
    }
}

fn document_in(directory: &Utf8Path) -> EmittedAppDocument {
    EmittedAppDocument {
        name: "tasks".to_owned(),
        file: directory.join("tasks.yaml"),
        text: "openapi: 3.1.0\n".to_owned(),
        level: CheckLevel::Warning,
    }
}

fn committed(
    outputs: Vec<GeneratedOutput>,
    documents: &[EmittedAppDocument],
    swept: &[SweptDirectory],
    io: &mut RecordingIo,
) -> TestResult<()> {
    let planned = plan_writes(outputs, documents, swept, HandEditPolicy::Refuse)?;
    let writes = committable_writes(planned).map_err(|stop| format!("{stop:?}"))?;

    Ok(commit_writes(writes, io)?)
}

#[test]
fn an_entry_prints_what_it_wrote_and_its_warnings() -> TestResult<()> {
    let temporary = tempfile::tempdir()?;
    let root = directory_of(&temporary)?.join("out");
    let warning = GenerateWarning {
        code: "form.handler".to_owned(),
        message: "left to you.".to_owned(),
        fix: "Handle it.".to_owned(),
        operation: None,
        member: Some("/operations/0".to_owned()),
    };
    let output = output_in(&root, "{\"a\":1}", vec![warning]);
    let mut first = RecordingIo::default();
    let mut second = RecordingIo::default();

    committed(vec![output.clone()], &[], &[], &mut first)?;
    committed(vec![output], &[], &[], &mut second)?;

    assert_eq!(
        first.stdout,
        format!("entry 'api', api 'tasks': 1 written, 0 unchanged, 0 removed ({root}).\n")
    );
    assert_eq!(
        second.stdout,
        format!("entry 'api', api 'tasks': 0 written, 1 unchanged, 0 removed ({root}).\n")
    );
    assert!(
        first.stderr.starts_with("warning: ") && first.stderr.contains("form.handler"),
        "stderr: {}",
        first.stderr
    );

    Ok(())
}

#[test]
fn documents_are_written_then_unchanged_then_removed_with_their_directory_swept() -> TestResult<()>
{
    let temporary = tempfile::tempdir()?;
    let directory = directory_of(&temporary)?.join("docs");
    let document = document_in(&directory);
    let swept = SweptDirectory {
        directory: directory.clone(),
        level: CheckLevel::Warning,
    };
    let mut written = RecordingIo::default();
    let mut unchanged = RecordingIo::default();
    let mut removed = RecordingIo::default();

    committed(
        Vec::new(),
        std::slice::from_ref(&document),
        &[],
        &mut written,
    )?;
    committed(
        Vec::new(),
        std::slice::from_ref(&document),
        &[],
        &mut unchanged,
    )?;
    committed(Vec::new(), &[], std::slice::from_ref(&swept), &mut removed)?;

    assert_eq!(
        written.stdout,
        format!("openapi document 'tasks': written ({}).\n", document.file)
    );
    assert_eq!(
        unchanged.stdout,
        format!("openapi document 'tasks': unchanged ({}).\n", document.file)
    );
    assert_eq!(
        removed.stdout,
        format!(
            "openapi document {}: removed.\n",
            directory.join("tasks.yaml")
        )
    );
    assert!(!document.file.exists());

    Ok(())
}

#[test]
fn a_file_seampact_did_not_write_in_a_document_directory_is_refused_as_a_document() -> TestResult<()>
{
    let temporary = tempfile::tempdir()?;
    let directory = directory_of(&temporary)?.join("docs");
    let document = document_in(&directory);

    fs::create_dir_all(&directory)?;
    fs::write(&document.file, "mine: true\n")?;

    let planned = plan_writes(
        Vec::new(),
        std::slice::from_ref(&document),
        &[],
        HandEditPolicy::Refuse,
    )?;
    let Err(Stop::Refused(problems)) = committable_writes(planned) else {
        return Err("the foreign file was not refused".into());
    };
    let codes: Vec<String> = problems.into_iter().map(|each| each.code).collect();

    assert_eq!(codes, ["openapi.document.not-generated"]);

    Ok(())
}
