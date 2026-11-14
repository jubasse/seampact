//! `$include`, `$file` and the file form of `$ref` (ADR 0002 section 2), expanded over the YAML
//! tree so that every merged node keeps the position it was written at.
//!
//! An [`Expander`] borrows the file store, the reporter, the budget and the schema positions of
//! one load, and builds one [`LayerBuild`] per layer file. `locs` maps a pointer of the layer to
//! the span it is written at. The recursion over the nesting is bounded by [`LOAD_MAX_DEPTH`]
//! (levels of the tree, and files in one include chain), as the walk of the file store is.

mod file_directive;
mod file_reference;
mod finish_refs;
mod include;
mod items;
mod json_file;
mod mapping_index;
mod scalar;
mod scope;

use std::collections::HashMap;
use std::rc::Rc;

use seampact_authoring::FileLayer;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue};
use seampact_span::{Location, Span};

use self::scope::{JsonFile, MapKeys, Scope, StackEntry};
use crate::budget::{LoadBudget, load_work_of};
use crate::fragments::LoadFragment;
use crate::layer_build::LayerBuild;
use crate::limits::LOAD_MAX_DEPTH;
use crate::positions::{Position, Positions, StepKind};
use crate::report::{LoadRule, PendingDiagnostic, RelatedSite, Reporter};
use crate::source::{FileStore, ParsedFile, node_span, pair_span};
use crate::yaml::{YamlKind, YamlNode, YamlPair};

pub use self::finish_refs::VisibleDeclaration;
pub(crate) use self::json_file::parse_json_document;
pub use self::mapping_index::{MappingIndex, key_string};

/// The parts of one load an [`Expander`] borrows, for the loader that works between two expansions.
pub struct LoadParts<'part, 'store> {
    /// The files of the load.
    pub store: &'part mut FileStore<'store>,
    /// The diagnostics of the load.
    pub reporter: &'part mut Reporter,
    /// The budget of the load.
    pub budget: &'part mut LoadBudget,
    /// The schema positions of the load.
    pub positions: &'part mut Positions,
}

/// Expands the layer files of one load.
pub struct Expander<'run, 'store> {
    store: &'run mut FileStore<'store>,
    reporter: &'run mut Reporter,
    budget: &'run mut LoadBudget,
    positions: &'run mut Positions,
    json_files: HashMap<String, Rc<JsonFile>>,
    mapping_indexes: HashMap<usize, Rc<MappingIndex>>,
    fragments: Vec<LoadFragment>,
}

impl<'run, 'store> Expander<'run, 'store> {
    /// An expander over the parts of one load.
    pub fn new(
        store: &'run mut FileStore<'store>,
        reporter: &'run mut Reporter,
        budget: &'run mut LoadBudget,
        positions: &'run mut Positions,
    ) -> Self {
        Self {
            store,
            reporter,
            budget,
            positions,
            json_files: HashMap::new(),
            mapping_indexes: HashMap::new(),
            fragments: Vec::new(),
        }
    }

    /// The parts of the load the expander borrows, each usable until the borrow of the expander
    /// ends.
    pub fn parts(&mut self) -> LoadParts<'_, 'store> {
        LoadParts {
            store: &mut *self.store,
            reporter: &mut *self.reporter,
            budget: &mut *self.budget,
            positions: &mut *self.positions,
        }
    }

    /// Every file an `$include` or a file `$ref` brought, in reading order.
    #[must_use]
    pub fn fragments(&self) -> &[LoadFragment] {
        &self.fragments
    }

    /// Expands a whole file as one layer, its scalars typed from `root` (by default, the root
    /// schema of the layer's kind).
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file or the schemas are broken.
    pub fn expand_layer(
        &mut self,
        file: &Rc<ParsedFile>,
        layer: FileLayer,
        root: Option<Position>,
    ) -> Result<LayerBuild, InternalError> {
        let root = match root {
            Some(root) => root,
            None => self.positions.root_position(layer.schema_kind())?,
        };
        let mut build = LayerBuild {
            layer,
            parsed: Rc::clone(file),
            tree: JsonObject::new(),
            locs: indexmap::IndexMap::new(),
            uses: Vec::new(),
            refs: indexmap::IndexMap::new(),
            pending_refs: Vec::new(),
            sources: indexmap::IndexMap::new(),
        };
        let Some(root_node) = &file.root else {
            return Ok(build);
        };
        let root_span = node_span(file, Some(root_node));

        build.locs.insert(String::new(), root_span);

        if !matches!(root_node.kind, YamlKind::Mapping(_)) {
            self.report(
                LoadRule::FileNotMapping,
                "the file does not hold a mapping at its top level".to_owned(),
                "write the file as a mapping of keys",
                root_span,
            )?;

            return Ok(build);
        }

        let scope = Scope {
            file: Rc::clone(file),
            data: false,
            pos: Some(root),
            parent_key: None,
            stack: Rc::new(vec![StackEntry {
                key: format!("{}#", self.store.real_of(&file.path)),
                shown: file.path.clone(),
                at: root_span,
            }]),
            depth: 0,
        };
        let value = self.node(&mut build, Some(root_node), "", &scope)?;

        if let JsonValue::Object(tree) = value {
            build.tree = tree;
        }

        Ok(build)
    }

    fn report(
        &mut self,
        rule: LoadRule,
        message: String,
        fix: &str,
        at: Span,
    ) -> Result<(), InternalError> {
        self.reporter.report(
            self.store.files(),
            PendingDiagnostic::new(rule, message, fix.to_owned(), at),
        )
    }

    fn report_with_related(
        &mut self,
        pending: PendingDiagnostic,
        related: Vec<RelatedSite>,
    ) -> Result<(), InternalError> {
        self.reporter
            .report(self.store.files(), pending.with_related(related))
    }

    fn charge(&mut self, units: u64, at: impl FnOnce() -> Span) -> Result<bool, InternalError> {
        self.budget
            .charge(units, at, self.reporter, self.store.files())
    }

    fn charge_text(
        &mut self,
        chars: u64,
        at: impl FnOnce() -> Span,
    ) -> Result<bool, InternalError> {
        self.budget
            .charge_text(chars, at, self.reporter, self.store.files())
    }

    fn report_too_deep(&mut self, at: Span) -> Result<(), InternalError> {
        self.store.report_too_deep(self.reporter, at)
    }

    fn location_of(&self, at: Span) -> Result<Location, InternalError> {
        self.store.files().location(at).ok_or_else(|| {
            InternalError::new(format!(
                "a fragment is at a span outside its file (file {})",
                at.file.index()
            ))
        })
    }

    /// Charges a node (or a pair) written at `pointer` to the load's budget, and its depth against
    /// the limit; false stops it.
    fn admit(
        &mut self,
        file: &ParsedFile,
        node: Option<&YamlNode>,
        depth: usize,
        pointer: &str,
    ) -> Result<bool, InternalError> {
        if !self.charge(load_work_of(pointer), || node_span(file, node))? {
            return Ok(false);
        }

        if depth > LOAD_MAX_DEPTH {
            self.report_too_deep(node_span(file, node))?;

            return Ok(false);
        }

        Ok(true)
    }

    fn node(
        &mut self,
        build: &mut LayerBuild,
        node: Option<&YamlNode>,
        pointer: &str,
        scope: &Scope,
    ) -> Result<JsonValue, InternalError> {
        let Some(node) = node else {
            return Ok(JsonValue::Null);
        };

        if matches!(node.kind, YamlKind::Alias(_)) {
            return Ok(JsonValue::Null);
        }

        if !self.admit(&scope.file, Some(node), scope.depth, pointer)? {
            return Ok(JsonValue::Null);
        }

        match &node.kind {
            YamlKind::Scalar { value, .. } => self.scalar(node, value, scope),
            YamlKind::Sequence(items) => self.sequence(build, items, pointer, scope),
            YamlKind::Mapping(pairs) => self.map(build, pairs, pointer, scope),
            YamlKind::Alias(_) => Ok(JsonValue::Null),
        }
    }

    fn sequence(
        &mut self,
        build: &mut LayerBuild,
        items: &[YamlNode],
        pointer: &str,
        scope: &Scope,
    ) -> Result<JsonValue, InternalError> {
        let mut out = Vec::with_capacity(items.len());

        for (index, item) in items.iter().enumerate() {
            let child = format!("{pointer}/{index}");
            // An item is a position like a key's value: an item of a data list (`examples`) is data.
            let pos = if scope.data {
                None
            } else {
                self.positions.step_position(
                    scope.pos.as_ref(),
                    &index.to_string(),
                    StepKind::Index,
                )?
            };
            let child_scope = Scope {
                data: scope.data || pos.as_ref().is_some_and(Position::is_data),
                pos,
                parent_key: None,
                depth: scope.depth + 1,
                ..scope.clone()
            };

            out.push(self.node(build, Some(item), &child, &child_scope)?);
            build.locs.insert(child, node_span(&scope.file, Some(item)));
        }

        Ok(JsonValue::Array(out))
    }

    fn map(
        &mut self,
        build: &mut LayerBuild,
        pairs: &[YamlPair],
        pointer: &str,
        scope: &Scope,
    ) -> Result<JsonValue, InternalError> {
        let index = self.mapping_index(pairs);
        let file_pair = index
            .pair_index("$file")
            .and_then(|position| pairs.get(position));

        if let Some(file_pair) = file_pair {
            if pairs.len() == 1 {
                return self.file_directive(build, file_pair, pointer, scope);
            }

            if !scope.data {
                self.report(
                    LoadRule::DirectiveSiblings,
                    "$file replaces the value that holds it, so it cannot sit beside other keys"
                        .to_owned(),
                    "keep $file alone in its mapping",
                    pair_span(&scope.file, Some(&file_pair.key), file_pair.value.as_ref()),
                )?;

                return Ok(JsonValue::Null);
            }
        }

        let mut out = JsonObject::new();

        self.items(
            build,
            pairs,
            pointer,
            scope,
            &mut out,
            &mut MapKeys::default(),
        )?;

        Ok(JsonValue::Object(out))
    }
}
