//! One load over a memory workspace or a fixture directory, and what it gave.

use std::cell::RefCell;

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_authoring::RawApi;
use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, diagnostic_location_key, print_diagnostics,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_load::{FsReader, LoadOptions, LoadOutput, LoadReader, MemoryReader, load_workspace};
use seampact_span::Location;

/// The result of one load.
pub struct Load {
    pub output: LoadOutput,
}

impl Load {
    /// The short rule ids in the order of the sorted diagnostics.
    pub fn rules(&self) -> Vec<&str> {
        self.output
            .diagnostics
            .iter()
            .map(|diagnostic| {
                diagnostic
                    .rule
                    .as_str()
                    .trim_start_matches("seampact/load/")
            })
            .collect()
    }

    /// Fails with the printed diagnostics unless the load reported none.
    pub fn assert_clean(&self) {
        assert_eq!(self.rules(), Vec::<&str>::new(), "{}", self.printed());
    }

    pub fn diagnostic(&self, index: usize) -> &Diagnostic {
        self.output
            .diagnostics
            .get(index)
            .unwrap_or_else(|| panic!("no diagnostic {index} in {:?}", self.rules()))
    }

    /// The table of locations of the workspace: every key to where it is written.
    pub fn locations(&self) -> IndexMap<String, Location> {
        self.output
            .files
            .locations(&self.output.workspace.locations)
            .expect("every location is in a file")
    }

    pub fn printed(&self) -> String {
        print_diagnostics(&self.output.diagnostics, &self.locations())
    }

    pub fn where_is(&self, origin: &DiagnosticOrigin) -> Location {
        self.locations()
            .get(&diagnostic_location_key(origin))
            .cloned()
            .unwrap_or_else(|| panic!("{origin:?} is not located"))
    }

    pub fn api(&self, index: usize) -> &RawApi {
        self.output
            .workspace
            .apis
            .get(index)
            .unwrap_or_else(|| panic!("no api {index}"))
    }

    pub fn api_location(&self, index: usize, key: &str) -> Location {
        let span = self
            .api(index)
            .locations
            .get(key)
            .unwrap_or_else(|| panic!("{key} is not in the table of api {index}"));

        self.output.files.location(*span).expect("a located span")
    }

    /// The merged tree of an api as JSON text, members in their order.
    pub fn merged_text(&self, index: usize) -> String {
        serde_json::to_string(&JsonValue::Object(self.api(index).merged.clone()))
            .expect("a JSON tree")
    }

    /// The merged tree of an api as a value.
    pub fn merged(&self, index: usize) -> serde_json::Value {
        json_of(&self.api(index).merged)
    }

    /// The member names of the mapping at `pointer` of the merged tree, in order.
    pub fn member_names(&self, index: usize, pointer: &str) -> Vec<String> {
        self.merged(index)
            .pointer(pointer)
            .and_then(serde_json::Value::as_object)
            .unwrap_or_else(|| panic!("no mapping at {pointer}"))
            .keys()
            .cloned()
            .collect()
    }

    /// The layers of an api in apply order, as `(layer, file)`.
    pub fn layers(&self, index: usize) -> Vec<(String, String)> {
        self.api(index)
            .layers
            .iter()
            .map(|layer| (layer.layer.to_string(), layer.file.clone()))
            .collect()
    }

    pub fn layer_of_origin(&self, index: usize, pointer: &str) -> String {
        self.api(index)
            .leaf_origins
            .get(pointer)
            .unwrap_or_else(|| panic!("no origin at {pointer}"))
            .layer
            .to_string()
    }
}

/// A tree as a JSON value.
pub fn json_of(tree: &JsonObject) -> serde_json::Value {
    serde_json::to_value(JsonValue::Object(tree.clone())).expect("a JSON tree")
}

pub fn owned(files: &[(&str, &str)]) -> Vec<(String, String)> {
    files
        .iter()
        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
        .collect()
}

/// Loads `api.yaml` of a memory workspace.
pub fn run(files: &[(&str, &str)]) -> Load {
    run_entry(files, "api.yaml")
}

/// Loads `entry` of a memory workspace.
pub fn run_entry(files: &[(&str, &str)], entry: &str) -> Load {
    run_on(&MemoryReader::new(owned(files)), entry)
}

/// Loads `entry` through `reader`.
pub fn run_on(reader: &dyn LoadReader, entry: &str) -> Load {
    let output = load_workspace(&LoadOptions { reader, entry }).expect("no internal error");

    Load { output }
}

/// The directory of a fixture of `fixtures/loader`.
pub fn fixture_directory(name: &str) -> Utf8PathBuf {
    Utf8PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/loader")
        .join(name)
}

/// Loads a fixture directory from its workspace file, or its api file.
pub fn run_fixture(name: &str) -> Load {
    let directory = fixture_directory(name);
    let entry = if directory.join("workspace.yaml").exists() {
        "workspace.yaml"
    } else {
        "api.yaml"
    };
    let reader = FsReader::new(&directory).expect("the fixture directory");

    run_on(&reader, entry)
}

/// A reader that remembers the files it was asked to read and the directories it listed.
pub struct SpyReader {
    inner: MemoryReader,
    reads: RefCell<Vec<String>>,
    listed: RefCell<Vec<String>>,
}

impl SpyReader {
    pub fn new(inner: MemoryReader) -> Self {
        Self {
            inner,
            reads: RefCell::new(Vec::new()),
            listed: RefCell::new(Vec::new()),
        }
    }

    pub fn reads(&self) -> Vec<String> {
        self.reads.borrow().clone()
    }

    pub fn listed(&self) -> Vec<String> {
        self.listed.borrow().clone()
    }
}

impl LoadReader for SpyReader {
    fn read_text(&self, file: &str, max_bytes: u64) -> Option<seampact_load::LoadText> {
        self.reads.borrow_mut().push(file.to_owned());

        self.inner.read_text(file, max_bytes)
    }

    fn list_dir(&self, dir: &str) -> Option<Vec<String>> {
        self.listed.borrow_mut().push(dir.to_owned());

        self.inner.list_dir(dir)
    }

    fn real_path(&self, file: &str) -> Option<String> {
        self.inner.real_path(file)
    }

    fn ascent(&self) -> u32 {
        self.inner.ascent()
    }
}
