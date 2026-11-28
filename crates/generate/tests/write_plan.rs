//! The writes of a run: planned and checked, then committed with what each wrote printed.

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::{CheckLevel, CliIo};
use seampact_generate::{
    EmittedAppDocument, GeneratedOutput, SweptDirectory, commit_writes, committable_writes,
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
fn a_printed_path_never_carries_a_raw_escape() -> TestResult<()> {
    let temporary = tempfile::tempdir()?;
    let directory = directory_of(&temporary)?.join("docs");
    let stale_name = "x\u{1b}[2J.yaml";
    let stale_hash = "37b128c59f1f5097f73f82691cb519f1f568667faab5ced1b4ab979d36837eae";
    let swept = SweptDirectory {
        directory: directory.clone(),
        level: CheckLevel::Warning,
    };
    let mut removal = RecordingIo::default();
    let mut entry = RecordingIo::default();

    fs::create_dir_all(&directory)?;
    fs::write(directory.join(stale_name), "a: 1\n")?;
    fs::write(
        directory.join(".seampact-manifest.json"),
        format!(
            "{{\"owner\":\"openapi\",\"files\":[{{\"path\":\"x\\u001b[2J.yaml\",\"sha256\":\"{stale_hash}\"}}]}}"
        ),
    )?;

    committed(Vec::new(), &[], std::slice::from_ref(&swept), &mut removal)?;

    let root = directory_of(&temporary)?.join("out\u{1b}[2J");
    let output = output_in(&root, "{\"a\":1}", Vec::new());

    committed(vec![output], &[], &[], &mut entry)?;

    assert!(
        !directory.join(stale_name).exists(),
        "the stale file stayed"
    );
    assert!(
        removal.stdout.contains("x\\u001B[2J.yaml"),
        "stdout: {:?}",
        removal.stdout
    );
    assert!(
        !removal.stdout.contains('\u{1b}') && !entry.stdout.contains('\u{1b}'),
        "stdout: {:?} and {:?}",
        removal.stdout,
        entry.stdout
    );

    Ok(())
}
