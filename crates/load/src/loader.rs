//! The loader entry (ADR 0006 section 1): a workspace read through a [`LoadReader`] into located
//! raw trees, its files, its sorted diagnostics and the fragments its includes brought.
//!
//! The flow is `loader.ts`: the entry check, the entry layer (`workspace` or `api`), the
//! workspace mode or the single-api mode, then per api its layers (`api`, `shared`, `base`, the
//! packs in apply order), the visibility of names and the merge. Diagnostics are reported in emit
//! order and sorted once at the end.

mod api;
mod builds;
mod entry;
mod package;
mod packs;
mod parts;
mod workspace_mode;

use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;
use seampact_authoring::{
    ApiLayer, FileLayer, JsonObjectExt, Locations, RawApi, RawEntryLayer, RawWorkspace,
    RawWorkspaceConfig, entry_location_key,
};
use seampact_diagnostics::{Diagnostic, InternalError, diagnostic_sort};
use seampact_js::cmp_utf16;
use seampact_json::JsonObject;
use seampact_span::{SourceFiles, Span};

use self::builds::{BuildId, Builds, site_in};
use self::packs::PackBuild;
use crate::ROOT_BOUNDARY;
use crate::budget::LoadBudget;
use crate::expand::Expander;
use crate::fragments::{LoadFragment, load_sort_fragments};
use crate::paths::{is_inside, load_normalize_path};
use crate::positions::Positions;
use crate::reader::LoadReader;
use crate::report::{LoadRule, Reporter};
use crate::source::{CheckedFile, FileStore, OnMissing};

/// The layer the loader reports under until it knows the entry's kind.
const API_LAYER: FileLayer = FileLayer::Api(ApiLayer::Api);

/// What a load reads and where it starts.
#[derive(Clone, Copy)]
pub struct LoadOptions<'run> {
    /// How the loader reaches files.
    pub reader: &'run dyn LoadReader,
    /// Root-relative path of the entry file: `workspace.yaml`, or an api file when there is none.
    pub entry: &'run str,
}

/// What a load gave.
#[derive(Debug)]
pub struct LoadOutput {
    /// The loaded workspace, as the passes read it.
    pub workspace: RawWorkspace,
    /// Every file read, normalised: the text the spans of the workspace and the diagnostics point
    /// into.
    pub files: SourceFiles,
    /// Every diagnostic of the load stage, sorted; the stage stops after it when any is an error.
    pub diagnostics: Vec<Diagnostic>,
    /// Every file the load read or tried to read, sorted, for the watch primitive.
    pub read_files: Vec<String>,
    /// Every file an include site or a file `$ref` brought, with the kind the site expects,
    /// sorted.
    pub fragments: Vec<LoadFragment>,
}

/// What the loader built before the diagnostics are sorted and the tables assembled.
struct LoadedParts {
    apis: Vec<RawApi>,
    config: RawWorkspaceConfig,
    entry: Option<EntryDocument>,
}

/// The whole entry document when it is a workspace file, and where each pointer of it is written.
struct EntryDocument {
    document: RawEntryLayer,
    locations: IndexMap<String, Span>,
}

/// Loads the workspace `options.entry` starts.
///
/// # Errors
///
/// [`InternalError`] when a diagnostic is located outside its file or a bundled schema is broken:
/// a bug, never something a contract file causes.
pub fn load_workspace(options: &LoadOptions<'_>) -> Result<LoadOutput, InternalError> {
    let mut store = FileStore::new(options.reader)?;
    let mut reporter = Reporter::new();
    let mut budget = LoadBudget::new();
    let mut positions = Positions::new()?;
    let (parts, fragments) = {
        let expander = Expander::new(&mut store, &mut reporter, &mut budget, &mut positions);
        let mut loader = Loader::new(options.reader, expander);
        let parts = loader.run(options.entry)?;
        let fragments = load_sort_fragments(loader.expander.fragments());

        (parts, fragments)
    };
    let (diagnostics, mut locations) = reporter.into_parts();
    let entry = parts.entry.map(|entry| {
        for (pointer, site) in entry.locations {
            locations.insert(entry_location_key(&pointer), site);
        }

        entry.document
    });
    let located = store.files().locations(&locations)?;
    let diagnostics = diagnostic_sort(diagnostics, &located);
    let mut read_files: Vec<String> = store.touched().iter().cloned().collect();

    read_files.sort_by(|left, right| cmp_utf16(left, right));

    Ok(LoadOutput {
        workspace: assemble_workspace(parts.apis, parts.config, entry, locations),
        files: store.into_files(),
        diagnostics,
        read_files,
        fragments,
    })
}

fn assemble_workspace(
    apis: Vec<RawApi>,
    config: RawWorkspaceConfig,
    entry: Option<RawEntryLayer>,
    locations: Locations,
) -> RawWorkspace {
    let has_config = config != RawWorkspaceConfig::default();

    RawWorkspace {
        root: ROOT_BOUNDARY.into(),
        apis,
        locations,
        entry,
        config: has_config.then_some(config),
    }
}

/// The names the packs of an api are found under, and the packs found.
struct ApiState {
    order: Vec<PackBuild>,
    done: HashSet<String>,
}

/// One load: its expander, the layer builds and the packs found so far.
struct Loader<'ex, 'run> {
    reader: &'run dyn LoadReader,
    expander: Expander<'ex, 'run>,
    builds: Builds,
    /// Layer builds by `<layer>|<boundary>|<path>`, each file built once per layer.
    cached: HashMap<String, BuildId>,
    /// The layers whose `$ref` files were finished.
    finished: HashSet<BuildId>,
    /// Packs by `<boundary>|<file>`; `None` for a refused pack.
    packs: HashMap<String, Option<PackBuild>>,
    /// The first pack of each name.
    pack_names: HashMap<String, PackBuild>,
    /// The pack key a reference written in a file resolved to, by `<file>|<reference>`.
    pack_keys: HashMap<String, String>,
}

impl<'ex, 'run> Loader<'ex, 'run> {
    fn new(reader: &'run dyn LoadReader, expander: Expander<'ex, 'run>) -> Self {
        Self {
            reader,
            expander,
            builds: Builds::default(),
            cached: HashMap::new(),
            finished: HashSet::new(),
            packs: HashMap::new(),
            pack_names: HashMap::new(),
            pack_keys: HashMap::new(),
        }
    }

    fn run(&mut self, entry_path: &str) -> Result<LoadedParts, InternalError> {
        let mut apis: Vec<RawApi> = Vec::new();
        let mut config = RawWorkspaceConfig::default();
        let entry = load_normalize_path(entry_path);
        let entry_site = self.expander.parts().store.unread_file_span(&entry)?;

        self.set_layer(API_LAYER);

        let entry_build = self.read_entry(&entry, entry_site)?;

        if let Some(entry_build) = entry_build {
            self.load_entry_kind(entry_build, &mut apis, &mut config)?;
        }

        let entry_document = match entry_build {
            Some(entry_build) => self.entry_document(entry_build)?,
            None => None,
        };

        Ok(LoadedParts {
            apis,
            config,
            entry: entry_document,
        })
    }

    /// Checks and parses the entry file, and gives its layer build.
    fn read_entry(
        &mut self,
        entry: &str,
        entry_site: Span,
    ) -> Result<Option<BuildId>, InternalError> {
        if !is_inside(ROOT_BOUNDARY, entry) {
            self.report(
                LoadRule::PathEscape,
                format!("the entry file '{entry}' is outside the workspace root"),
                "name an entry file inside the workspace root",
                entry_site,
            )?;

            return Ok(None);
        }

        let checked = {
            let parts = self.expander.parts();

            parts.store.check_file(
                parts.reporter,
                entry,
                ROOT_BOUNDARY,
                entry_site,
                "the entry file",
                entry,
                OnMissing::Report,
            )?
        };

        if !matches!(checked, CheckedFile::Real(_)) {
            return Ok(None);
        }

        // Its kind, so its layer, is known once it is read: what parsing reported moves to it.
        let since = self.reported_count();
        let parsed = {
            let parts = self.expander.parts();

            parts.store.parse(parts.reporter, entry, ROOT_BOUNDARY)?
        };
        let Some(parsed) = parsed else {
            return Ok(None);
        };
        let entry_build = self.entry_layer(&parsed)?;

        if self.builds.get(entry_build)?.layer == FileLayer::Workspace {
            self.relabel(since, &API_LAYER, &FileLayer::Workspace);
        }

        Ok(Some(entry_build))
    }

    /// The whole entry document of a workspace file, located by `workspace#<pointer>`: the
    /// `workspace` layer id is never an api layer's, and the load sites' pointers start `/~load/`.
    fn entry_document(&self, entry_build: BuildId) -> Result<Option<EntryDocument>, InternalError> {
        let build = self.builds.get(entry_build)?;

        if build.layer != FileLayer::Workspace {
            return Ok(None);
        }

        Ok(Some(EntryDocument {
            document: RawEntryLayer {
                file: build.parsed.path.clone(),
                tree: build.tree.clone(),
            },
            locations: build.locs.clone(),
        }))
    }

    /// Reads the entry as a workspace or as one api, whichever its keys say.
    fn load_entry_kind(
        &mut self,
        entry_build: BuildId,
        apis: &mut Vec<RawApi>,
        config: &mut RawWorkspaceConfig,
    ) -> Result<(), InternalError> {
        // What is reported on the entry from here on is the entry's layer's.
        let shape = self.entry_shape(entry_build)?;

        self.set_layer(shape.layer.clone());

        if shape.has_workspace && shape.has_api {
            return self.bad_shape(
                entry_build,
                "/api",
                "the entry file is both a workspace (workspace:) and an api (api:)",
                "keep one of them: a workspace names its api files, an api file is the entry of one api",
            );
        }

        match (shape.layer, shape.workspace, shape.api) {
            // `workspace:` holds no mapping: P6 or the validate stage reports it, nothing more here.
            (FileLayer::Workspace, None, _) => Ok(()),
            (FileLayer::Workspace, Some(workspace), _) => {
                self.workspace_mode(entry_build, &workspace, apis, config)
            }
            (FileLayer::Api(_), _, ApiShape::Named(name)) => {
                self.load_api(&name, entry_build, None, apis)
            }
            (FileLayer::Api(_), _, ApiShape::Unnamed) => self.bad_shape(
                entry_build,
                "/api",
                "the api file has no api.name",
                "write api: { name: <name> }",
            ),
            _ => self.bad_shape(
                entry_build,
                "",
                "the entry file is neither a workspace (workspace:) nor an api (api:)",
                "start the file with workspace: or api:",
            ),
        }
    }

    fn bad_shape(
        &mut self,
        build: BuildId,
        pointer: &str,
        message: &str,
        fix: &str,
    ) -> Result<(), InternalError> {
        let at = site_in(self.builds.get(build)?, pointer);

        self.report(LoadRule::WorkspaceShape, message.to_owned(), fix, at)
    }
}

/// What the entry's tree says about its kind.
struct EntryShape {
    layer: FileLayer,
    has_workspace: bool,
    has_api: bool,
    /// The `workspace` mapping, when it is one.
    workspace: Option<JsonObject>,
    api: ApiShape,
}

/// What the entry's `api` member is.
enum ApiShape {
    /// Absent, or not a mapping.
    NotMapping,
    /// A mapping with no string `name`.
    Unnamed,
    /// A mapping with this `name`.
    Named(String),
}

impl Loader<'_, '_> {
    fn entry_shape(&self, entry_build: BuildId) -> Result<EntryShape, InternalError> {
        let build = self.builds.get(entry_build)?;
        let tree: &JsonObject = &build.tree;

        Ok(EntryShape {
            layer: build.layer.clone(),
            has_workspace: tree.member("workspace").is_some(),
            has_api: tree.member("api").is_some(),
            workspace: tree.object("workspace").cloned(),
            api: match tree.object("api") {
                None => ApiShape::NotMapping,
                Some(api) => api
                    .string("name")
                    .map_or(ApiShape::Unnamed, |name| ApiShape::Named(name.to_owned())),
            },
        })
    }
}
