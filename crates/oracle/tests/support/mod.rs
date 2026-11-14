//! The repository root and the test subjects of the integration tests.

#![allow(
    dead_code,
    reason = "each integration test binary uses a part of the support module"
)]

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, CompiledApi, DIAGNOSTICS_FILE, Fixture, HalfInput, HalfOutput, OracleSubject,
    RecordedCall, RuleIdRegistry, SubjectAnswer, expected_directory_of,
};

/// The repository root, two levels above this crate.
pub fn repository_root() -> Utf8PathBuf {
    Utf8Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A fresh scratch directory for one test.
pub fn scratch_directory(name: &str) -> Utf8PathBuf {
    let directory = Utf8PathBuf::from_path_buf(std::env::temp_dir())
        .unwrap()
        .join(format!("seampact-oracle-{name}-{}", std::process::id()));

    fs::create_dir_all(&directory).unwrap();

    directory
}

/// A subject that answers every fixture with its expected files, each text passed through
/// `rewrite` (the file name under the fixture's expected directory, the text).
pub struct ExpectedFilesSubject {
    pub repository_root: Utf8PathBuf,
    pub rewrite: fn(&str, &str) -> String,
}

impl ExpectedFilesSubject {
    fn expected_text(&self, fixture: &Fixture, name: &str) -> Option<String> {
        let path = expected_directory_of(&self.repository_root, fixture).join(name);
        let text = fs::read_to_string(path).ok()?;

        Some((self.rewrite)(name, &text))
    }

    fn api_names(&self, fixture: &Fixture) -> Vec<String> {
        let ir_directory = expected_directory_of(&self.repository_root, fixture).join("ir");

        let Ok(entries) = fs::read_dir(ir_directory) else {
            return Vec::new();
        };

        let mut api_names: Vec<String> = entries
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter_map(|file_name| file_name.strip_suffix(".json").map(str::to_owned))
            .collect();

        api_names.sort();

        api_names
    }

    fn half_file_name(&self, fixture: &Fixture, api: &str, half: &str) -> String {
        let halves_directory = expected_directory_of(&self.repository_root, fixture)
            .join("halves")
            .join(api);
        let suffix = format!("-{half}.json");

        fs::read_dir(halves_directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .find(|file_name| file_name.ends_with(&suffix))
            .map(|file_name| format!("halves/{api}/{file_name}"))
            .unwrap()
    }
}

impl OracleSubject for ExpectedFilesSubject {
    fn compile(&self, fixture: &Fixture) -> SubjectAnswer<Compilation> {
        let diagnostics_text = self.expected_text(fixture, DIAGNOSTICS_FILE).unwrap();
        let diagnostics: JsonValue = serde_json::from_str(&diagnostics_text).unwrap();

        let apis = self
            .api_names(fixture)
            .into_iter()
            .map(|api| CompiledApi {
                ir: self.expected_text(fixture, &format!("ir/{api}.json")),
                source_map: self.expected_text(fixture, &format!("source-map/{api}.json")),
                api,
            })
            .collect();

        SubjectAnswer::Ported(Compilation { diagnostics, apis })
    }

    fn run_half(
        &self,
        fixture: &Fixture,
        api: &str,
        half: &str,
        _input: &HalfInput<'_>,
        _calls: &[RecordedCall],
    ) -> SubjectAnswer<HalfOutput> {
        let name = self.half_file_name(fixture, api, half);
        let text = self.expected_text(fixture, &name).unwrap();
        let diagnostics_name = name.replace(".json", ".diagnostics.json");
        let diagnostics = self
            .expected_text(fixture, &diagnostics_name)
            .map_or(JsonValue::Array(Vec::new()), |text| {
                serde_json::from_str(&text).unwrap()
            });

        SubjectAnswer::Ported(HalfOutput {
            delta: serde_json::from_str(&text).unwrap(),
            diagnostics,
        })
    }

    fn replay_schema_calls(
        &self,
        _fixture: &Fixture,
        _api: &str,
        _input: &HalfInput<'_>,
        calls: &[RecordedCall],
    ) -> SubjectAnswer<Vec<Option<JsonValue>>> {
        SubjectAnswer::Ported(calls.iter().map(|call| call.answer.clone()).collect())
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

/// The text unchanged.
pub fn unchanged(_name: &str, text: &str) -> String {
    text.to_owned()
}

/// The fixture of a scratch repository.
pub const SCRATCH_FIXTURE: &str = "one";

/// A scratch repository with one fixture and no intended difference, holding `expected_files`
/// under `fixtures/expected/one/`; the differences schema is the repository's own.
pub fn scratch_repository(name: &str, expected_files: &[(&str, &str)]) -> Utf8PathBuf {
    let root = scratch_directory(name);
    let schema_file = "scripts/oracle/differences.schema.json";

    let mut files = vec![
        (schema_file.to_owned(), read_repository_file(schema_file)),
        (
            "scripts/oracle/excluded.json".to_owned(),
            r#"{ "fixtures": {}, "halves": {} }"#.to_owned(),
        ),
        ("fixtures/one/api.yaml".to_owned(), "api: one\n".to_owned()),
        (
            "fixtures/expected/differences.yaml".to_owned(),
            "version: 1\ndifferences: []\n".to_owned(),
        ),
        (
            "fixtures/expected/rule-coverage.json".to_owned(),
            "{}".to_owned(),
        ),
    ];

    for (file, text) in expected_files {
        files.push((
            format!("fixtures/expected/{SCRATCH_FIXTURE}/{file}"),
            (*text).to_owned(),
        ));
    }

    for (file, text) in files {
        let path = root.join(file);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    root
}

fn read_repository_file(file: &str) -> String {
    fs::read_to_string(repository_root().join(file)).unwrap()
}
