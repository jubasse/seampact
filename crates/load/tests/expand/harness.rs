//! One expansion over a memory workspace, and what it reported.

use indexmap::IndexMap;
use seampact_authoring::{ApiLayer, FileLayer};
use seampact_diagnostics::{Diagnostic, print_diagnostics};
use seampact_json::JsonValue;
use seampact_load::positions::Positions;
use std::cell::RefCell;

thread_local! {
    // Reading the schemas is the costly part of a run; what a run learns is only a cache.
    static POSITIONS: RefCell<Positions> = RefCell::new(Positions::new().expect("the schemas load"));
}
use seampact_load::{
    Expander, FileStore, LayerBuild, LoadBudget, LoadFragment, LoadReader, MemoryReader,
    ROOT_BOUNDARY, Reporter, VisibleDeclaration, load_sort_fragments,
};
use seampact_span::Location;

/// Which position types the root of the file.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RootChoice {
    /// The root schema of the layer's kind.
    OfLayer,
    /// The entry root: a workspace or an api.
    Entry,
}

/// What to expand and how.
pub struct Options {
    pub entry: &'static str,
    pub layer: FileLayer,
    pub root: RootChoice,
    pub finish_refs: bool,
    pub links: Vec<(String, String)>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            entry: "api.yaml",
            layer: FileLayer::Api(ApiLayer::Api),
            root: RootChoice::OfLayer,
            finish_refs: false,
            links: Vec::new(),
        }
    }
}

/// The outcome of one expansion.
pub struct Run {
    pub build: LayerBuild,
    pub diagnostics: Vec<Diagnostic>,
    pub printed: String,
    pub fragments: Vec<LoadFragment>,
    pub read_files: Vec<String>,
    pub exhausted: bool,
}

impl Run {
    /// The short rule ids, in the order they were reported.
    pub fn rules(&self) -> Vec<&str> {
        self.diagnostics
            .iter()
            .map(|diagnostic| {
                diagnostic
                    .rule
                    .as_str()
                    .trim_start_matches("seampact/load/")
            })
            .collect()
    }

    /// The expanded tree as JSON text, keys in order.
    pub fn tree_text(&self) -> String {
        serde_json::to_string(&JsonValue::Object(self.build.tree.clone())).expect("a JSON tree")
    }
}

pub fn owned(files: &[(&str, &str)]) -> Vec<(String, String)> {
    files
        .iter()
        .map(|(path, text)| ((*path).to_owned(), (*text).to_owned()))
        .collect()
}

/// Expands `api.yaml` as the api layer.
pub fn expand(files: &[(&str, &str)]) -> Run {
    expand_with(owned(files), &Options::default())
}

pub fn expand_with(files: Vec<(String, String)>, options: &Options) -> Run {
    let reader = MemoryReader::new(files).with_links(options.links.clone());

    expand_on(&reader, options)
}

/// Expands the entry of `options` read through `reader`.
pub fn expand_on(reader: &dyn LoadReader, options: &Options) -> Run {
    POSITIONS.with_borrow_mut(|positions| expand_with_positions(reader, options, positions))
}

fn expand_with_positions(
    reader: &dyn LoadReader,
    options: &Options,
    positions: &mut Positions,
) -> Run {
    let mut store = FileStore::new(reader).expect("the store builds");
    let mut reporter = Reporter::new();
    let mut budget = LoadBudget::new();
    let parsed = store
        .parse(&mut reporter, options.entry, ROOT_BOUNDARY)
        .expect("no internal error")
        .expect("the entry is there");
    let root = match options.root {
        RootChoice::OfLayer => None,
        RootChoice::Entry => Some(positions.entry_root_position().expect("the entry root")),
    };
    let mut expander = Expander::new(&mut store, &mut reporter, &mut budget, positions);
    let mut build = expander
        .expand_layer(&parsed, options.layer.clone(), root)
        .expect("no internal error");

    if options.finish_refs {
        expander
            .finish_refs(&mut build, |_, _| Ok(None::<VisibleDeclaration>))
            .expect("no internal error");
    }

    let fragments = load_sort_fragments(expander.fragments());
    let exhausted = budget.exhausted();
    let locations: IndexMap<String, Location> = reporter
        .locations()
        .iter()
        .filter_map(|(key, span)| store.files().location(*span).map(|at| (key.clone(), at)))
        .collect();

    Run {
        printed: print_diagnostics(reporter.diagnostics(), &locations),
        diagnostics: reporter.diagnostics().to_vec(),
        build,
        fragments,
        read_files: store.touched().iter().cloned().collect(),
        exhausted,
    }
}
