//! The repository root and the test subjects of the integration tests.

#![allow(
    dead_code,
    reason = "each integration test binary uses a part of the support module"
)]

use std::fs;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_json::JsonValue;
use seampact_oracle::{
    Compilation, CompiledApi, DIAGNOSTICS_FILE, Fixture, OracleSubject, RuleIdRegistry,
    SubjectAnswer, expected_directory_of,
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
        _input: Option<&JsonValue>,
    ) -> SubjectAnswer<JsonValue> {
        let name = self.half_file_name(fixture, api, half);
        let text = self.expected_text(fixture, &name).unwrap();

        SubjectAnswer::Ported(serde_json::from_str(&text).unwrap())
    }

    fn rule_id_registry(&self) -> RuleIdRegistry {
        RuleIdRegistry::empty()
    }
}

/// The text unchanged.
pub fn unchanged(_name: &str, text: &str) -> String {
    text.to_owned()
}
