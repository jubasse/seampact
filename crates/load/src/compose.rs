//! Composing the layer builds of one api into its raw tree (ADR 0002 section 2, Layers and
//! overrides).
//!
//! Layers are built once and shared by the apis that build on them, so this is where one layer's
//! size is paid once per api: every node copied, every origin and pointer written is charged to the
//! load's budget, and the merge stops once it is spent. Every walk over authored depth keeps its
//! own stack, so a deep tree costs memory, never the call stack.

use std::collections::{HashMap, HashSet};
use std::slice;

use indexmap::{IndexMap, map};
use seampact_authoring::{ApiLayer, FileLayer};
use seampact_diagnostics::InternalError;
use seampact_ir::{Layer, Origin};
use seampact_json::{JsonObject, JsonValue, escape_pointer};
use seampact_span::{SourceFiles, Span};

use crate::json::json_stringify;
use crate::report::{LoadRule, PendingDiagnostic, RelatedSite};
use crate::source::node_span;
use crate::{LayerBuild, LoadBudget, Reporter, load_work_of, utf16_length};

/// Declarations are never overridden: one name declared by two layers is an error.
const DECLARATION_SECTIONS: [&str; 16] = [
    "schemas",
    "enums",
    "scalars",
    "errors",
    "natures",
    "schemes",
    "headers",
    "identities",
    "rights",
    "rules",
    "requirements",
    "scopes",
    "buckets",
    "services",
    "pagings",
    "formats",
];

/// Keys that direct the loader and are not part of what the layers declare.
const DIRECTIVE_KEYS: [&str; 4] = ["extends", "packs", "pack", "workspace"];

/// Maps of named entries merge per entry, each entry being a leaf.
const LEAF_MAPS: [&str; 2] = ["/conventions/cache/families", "/conventions/errors/derived"];

/// `errors.every` is a union of every layer's list.
const UNION_LISTS: [&str; 1] = ["/conventions/errors/every"];

const FIRST_DECLARED_HERE: &str = "first declared here";

/// What merging the layers of an api gives.
#[derive(Debug, Clone, PartialEq)]
pub struct Merged {
    /// The merged raw tree.
    pub merged: JsonObject,
    /// For each leaf of the merged tree, the layer and the pointer it was written at, in the
    /// merged tree's own order.
    pub leaf_origins: IndexMap<String, Origin>,
}

/// Who declared a name first: a declaration is reported against it.
struct DeclarationOwner {
    layer: String,
    file: String,
    at: Span,
    /// The file element the declaration came from, when it came from one.
    source: Option<String>,
}

/// A merged object being merged into, taken out of its parent until its entries are done.
struct MergeFrame<'layer> {
    object: JsonObject,
    /// The key the object goes back to in its parent.
    key: String,
    pointer: String,
    layer_pointer: String,
    entries: map::Iter<'layer, String, JsonValue>,
}

/// A value being copied: the source members left to copy and the copy so far.
enum CopyFrame<'value> {
    Array {
        items: slice::Iter<'value, JsonValue>,
        copied: Vec<JsonValue>,
    },
    Object {
        members: map::Iter<'value, String, JsonValue>,
        copied: JsonObject,
        pending_key: Option<&'value str>,
    },
}

/// What one step of a copy did.
enum Advance<'value> {
    /// A node is copied: the innermost frame takes it, or it is the result.
    Finished(JsonValue),
    /// A container was entered.
    Pushed,
    /// The innermost frame has this member to enter next.
    Descend(&'value JsonValue),
}

enum Entered<'value> {
    Finished(JsonValue),
    Container(CopyFrame<'value>),
}

impl CopyFrame<'_> {
    fn accept(&mut self, child: JsonValue) -> Result<(), InternalError> {
        match self {
            Self::Array { copied, .. } => copied.push(child),
            Self::Object {
                copied,
                pending_key,
                ..
            } => {
                let Some(key) = pending_key.take() else {
                    return Err(InternalError::new(
                        "a copied member finished with no key waiting for it",
                    ));
                };

                copied.insert(key.to_owned(), child);
            }
        }

        Ok(())
    }

    fn into_value(self) -> JsonValue {
        match self {
            Self::Array { copied, .. } => JsonValue::Array(copied),
            Self::Object { copied, .. } => JsonValue::Object(copied),
        }
    }
}

/// Merges an api's layers, in order.
///
/// Every value taken from a layer is copied: layers are cached and shared by the apis that build
/// on them, so a merge never writes into one. No layer gives an empty tree and no origin.
///
/// # Errors
///
/// [`InternalError`] when a diagnostic's site is outside its file.
pub fn merge_layers(
    layers: &[LayerBuild],
    reporter: &mut Reporter,
    files: &SourceFiles,
    budget: &mut LoadBudget,
) -> Result<Merged, InternalError> {
    let Some(last_layer) = layers.last() else {
        return Ok(Merged {
            merged: JsonObject::new(),
            leaf_origins: IndexMap::new(),
        });
    };
    let mut composer = Composer {
        reporter,
        files,
        budget,
        here: site_at(last_layer, ""),
        winners: HashMap::new(),
        unions: HashMap::new(),
        owners: HashMap::new(),
    };
    let mut merged = JsonObject::new();

    for layer_build in layers {
        composer.merge_layer(layer_build, &mut merged)?;
    }

    // Emit in the merged tree's own order, so the record never depends on how it was built.
    composer.here = site_at(last_layer, "");

    let leaf_origins = composer.leaf_origins_of(&merged)?;

    Ok(Merged {
        merged,
        leaf_origins,
    })
}

/// A declaration is always reported: without its own position, at its layer file's top.
fn site_at(layer_build: &LayerBuild, pointer: &str) -> Span {
    layer_build
        .locs
        .get(pointer)
        .or_else(|| layer_build.locs.get(""))
        .copied()
        .unwrap_or_else(|| node_span(&layer_build.parsed, layer_build.parsed.root.as_ref()))
}

fn origin_of(layer: &FileLayer, pointer: &str) -> Origin {
    Origin {
        api: None,
        layer: Layer::from(layer.clone()),
        pointer: pointer.to_owned(),
    }
}

fn child_pointer(pointer: &str, segment: &str) -> String {
    format!("{pointer}/{}", escape_pointer(segment))
}

/// Pushes the children of `value` so that popping gives them in the value's own order.
fn push_children<'value>(
    pending: &mut Vec<(String, &'value JsonValue)>,
    pointer: &str,
    value: &'value JsonValue,
) {
    match value {
        JsonValue::Object(members) => push_members(pending, pointer, members),
        JsonValue::Array(items) => {
            for (index, item) in items.iter().enumerate().rev() {
                pending.push((format!("{pointer}/{index}"), item));
            }
        }
        _ => {}
    }
}

fn push_members<'value>(
    pending: &mut Vec<(String, &'value JsonValue)>,
    pointer: &str,
    members: &'value JsonObject,
) {
    for (key, member) in members.iter().rev() {
        pending.push((child_pointer(pointer, key), member));
    }
}

/// The object under `key`, which the caller has just made sure is one.
fn object_member_mut<'tree>(
    parent: &'tree mut JsonObject,
    key: &str,
) -> Result<&'tree mut JsonObject, InternalError> {
    match parent.get_mut(key) {
        Some(JsonValue::Object(object)) => Ok(object),
        _ => Err(InternalError::new(format!(
            "'{key}' of the merged tree is not an object"
        ))),
    }
}

/// Puts a finished frame's object back where it was taken from: the frame below it, else the
/// tree the merge started in.
fn check_in(frames: &mut [MergeFrame<'_>], root_parent: &mut JsonObject, done: MergeFrame<'_>) {
    let parent = match frames.last_mut() {
        Some(frame) => &mut frame.object,
        None => root_parent,
    };

    // The key holds the placeholder left when the object was taken, so it keeps its place.
    parent.insert(done.key, JsonValue::Object(done.object));
}

/// The state of merging one api's layers; the merged tree itself is passed around, never held.
struct Composer<'run> {
    reporter: &'run mut Reporter,
    files: &'run SourceFiles,
    budget: &'run mut LoadBudget,
    /// Where the work being charged comes from, for the report when the budget runs out.
    here: Span,
    /// The origin of each merged pointer that is a leaf.
    winners: HashMap<String, Origin>,
    /// Per union pointer, the members already in the merged list (serialised).
    unions: HashMap<String, HashSet<String>>,
    owners: HashMap<String, DeclarationOwner>,
}

impl Composer<'_> {
    fn charge(&mut self, units: u64) -> Result<bool, InternalError> {
        let here = self.here;

        self.budget
            .charge(units, || here, self.reporter, self.files)
    }

    fn charge_text(&mut self, text: &str) -> Result<bool, InternalError> {
        let here = self.here;

        self.budget
            .charge_text(utf16_length(text), || here, self.reporter, self.files)
    }

    /// Copies `value`, charging each node and each string and key.
    ///
    /// A node the budget refuses is `null`; a mapping stops at the first key it refuses.
    fn copy(&mut self, value: &JsonValue) -> Result<JsonValue, InternalError> {
        let mut frames: Vec<CopyFrame<'_>> = Vec::new();
        let mut next_node = Some(value);

        loop {
            let finished = match self.advance_copy(&mut frames, next_node.take())? {
                Advance::Finished(copied) => copied,
                Advance::Pushed => continue,
                Advance::Descend(child) => {
                    next_node = Some(child);

                    continue;
                }
            };

            match frames.last_mut() {
                Some(parent) => parent.accept(finished)?,
                None => return Ok(finished),
            }
        }
    }

    /// Enters `node` when there is one, else moves the innermost frame to its next member.
    fn advance_copy<'value>(
        &mut self,
        frames: &mut Vec<CopyFrame<'value>>,
        node: Option<&'value JsonValue>,
    ) -> Result<Advance<'value>, InternalError> {
        if let Some(node) = node {
            return Ok(match self.enter_copy(node)? {
                Entered::Finished(copied) => Advance::Finished(copied),
                Entered::Container(frame) => {
                    frames.push(frame);

                    Advance::Pushed
                }
            });
        }

        let Some(mut frame) = frames.pop() else {
            return Err(InternalError::new("a copy ran out of frames"));
        };

        Ok(match self.next_copy_child(&mut frame)? {
            Some(child) => {
                frames.push(frame);

                Advance::Descend(child)
            }
            None => Advance::Finished(frame.into_value()),
        })
    }

    fn enter_copy<'value>(
        &mut self,
        node: &'value JsonValue,
    ) -> Result<Entered<'value>, InternalError> {
        if !self.charge(1)? {
            return Ok(Entered::Finished(JsonValue::Null));
        }

        if let JsonValue::String(text) = node
            && !self.charge_text(text)?
        {
            return Ok(Entered::Finished(JsonValue::Null));
        }

        Ok(match node {
            JsonValue::Array(items) => Entered::Container(CopyFrame::Array {
                items: items.iter(),
                copied: Vec::with_capacity(items.len()),
            }),
            JsonValue::Object(members) => Entered::Container(CopyFrame::Object {
                members: members.iter(),
                copied: JsonObject::new(),
                pending_key: None,
            }),
            scalar => Entered::Finished(scalar.clone()),
        })
    }

    fn next_copy_child<'value>(
        &mut self,
        frame: &mut CopyFrame<'value>,
    ) -> Result<Option<&'value JsonValue>, InternalError> {
        match frame {
            CopyFrame::Array { items, .. } => Ok(items.next()),
            CopyFrame::Object {
                members,
                pending_key,
                ..
            } => {
                let Some((key, member)) = members.next() else {
                    return Ok(None);
                };

                if !self.charge_text(key)? {
                    return Ok(None);
                }

                *pending_key = Some(key.as_str());

                Ok(Some(member))
            }
        }
    }

    /// Visits `pending` and everything under it in order, charging the work of each pointer; a
    /// node the budget refuses is not visited and its children are not walked.
    fn walk_pointers(
        &mut self,
        mut pending: Vec<(String, &JsonValue)>,
        visit: &mut impl FnMut(&mut Self, &str),
    ) -> Result<(), InternalError> {
        while let Some((pointer, value)) = pending.pop() {
            if !self.charge(load_work_of(&pointer))? {
                continue;
            }

            visit(self, &pointer);
            push_children(&mut pending, &pointer, value);
        }

        Ok(())
    }

    /// The origins under a replaced value are those of its own nodes: walking the value it
    /// replaces costs what writing that value cost, never a scan of every origin.
    fn clear(&mut self, pointer: &str, old: Option<&JsonValue>) -> Result<(), InternalError> {
        let Some(old) = old else {
            return Ok(());
        };

        self.walk_pointers(vec![(pointer.to_owned(), old)], &mut |composer, node| {
            composer.winners.remove(node);
            composer.unions.remove(node);
        })
    }

    /// Writes the origin of every leaf of `value`, which sits at `merged_pointer` in the merged
    /// tree and at `layer_pointer` in `layer`. A list, a scalar and an empty mapping are leaves.
    fn record(
        &mut self,
        value: &JsonValue,
        merged_pointer: &str,
        layer: &FileLayer,
        layer_pointer: &str,
    ) -> Result<(), InternalError> {
        let mut pending = vec![(merged_pointer.to_owned(), layer_pointer.to_owned(), value)];

        while let Some((merged_pointer, layer_pointer, value)) = pending.pop() {
            if !self.charge(load_work_of(&merged_pointer))? {
                continue;
            }

            match value {
                JsonValue::Object(members) if !members.is_empty() => {
                    for (key, member) in members.iter().rev() {
                        pending.push((
                            child_pointer(&merged_pointer, key),
                            child_pointer(&layer_pointer, key),
                            member,
                        ));
                    }
                }
                _ => {
                    let origin = origin_of(layer, &layer_pointer);

                    self.winners.insert(merged_pointer, origin);
                }
            }
        }

        Ok(())
    }

    fn report_declaration_twice(
        &mut self,
        message: String,
        fix: &str,
        at: Span,
        first_at: Span,
    ) -> Result<(), InternalError> {
        let pending =
            PendingDiagnostic::new(LoadRule::DeclarationTwice, message, fix.to_owned(), at)
                .with_related(vec![RelatedSite {
                    at: first_at,
                    message: FIRST_DECLARED_HERE.to_owned(),
                }]);

        self.reporter.report(self.files, pending)
    }

    /// Declares `name` in `section`: a second declaration of the same pointer is an error, unless
    /// it is one file element reached twice.
    fn declare(
        &mut self,
        layer_build: &LayerBuild,
        section: &mut JsonObject,
        name: &str,
        value: &JsonValue,
        pointer: &str,
        what: &str,
    ) -> Result<(), InternalError> {
        let source = layer_build.sources.get(pointer);

        if let Some(owner) = self.owners.get(pointer) {
            // One file element reached by two layers (through `$ref` or `$include`) is one
            // declaration.
            if source.is_some() && owner.source.as_ref() == source {
                return Ok(());
            }

            let message = format!(
                "'{name}' ({what}) is declared by both '{}' ({}) and '{}' ({}), and a declaration is never overridden, even when the two are identical",
                owner.layer, owner.file, layer_build.layer, layer_build.parsed.path
            );
            let first_at = owner.at;

            return self.report_declaration_twice(
                message,
                "remove the copy",
                site_at(layer_build, pointer),
                first_at,
            );
        }

        self.owners.insert(
            pointer.to_owned(),
            DeclarationOwner {
                layer: layer_build.layer.to_string(),
                file: layer_build.parsed.path.clone(),
                at: site_at(layer_build, pointer),
                source: source.cloned(),
            },
        );

        let copied = self.copy(value)?;

        section.insert(name.to_owned(), copied);
        self.winners
            .insert(pointer.to_owned(), origin_of(&layer_build.layer, pointer));

        self.record(value, pointer, &layer_build.layer, pointer)
    }

    /// The object under `key` of `parent`; a setting written where a later layer declares is
    /// replaced by one, its origins cleared.
    fn ensure<'tree>(
        &mut self,
        parent: &'tree mut JsonObject,
        key: &str,
        pointer: &str,
    ) -> Result<&'tree mut JsonObject, InternalError> {
        if !matches!(parent.get(key), Some(JsonValue::Object(_))) {
            self.clear(pointer, parent.get(key))?;
            parent.insert(key.to_owned(), JsonValue::Object(JsonObject::new()));
        }

        object_member_mut(parent, key)
    }

    /// Merges the layer's value at `key` into `parent` as a setting: leaves override, mappings
    /// merge, the union lists extend.
    fn setting(
        &mut self,
        layer_build: &LayerBuild,
        parent: &mut JsonObject,
        key: &str,
        value: &JsonValue,
        pointer: &str,
        layer_pointer: &str,
    ) -> Result<(), InternalError> {
        let Some(first) =
            self.setting_step(layer_build, parent, key, value, pointer, layer_pointer)?
        else {
            return Ok(());
        };
        let mut frames = vec![first];

        while let Some(mut frame) = frames.pop() {
            if self.budget.exhausted() {
                frames.push(frame);

                break;
            }

            let Some((entry_key, entry_value)) = frame.entries.next() else {
                check_in(&mut frames, parent, frame);

                continue;
            };
            let entry_pointer = child_pointer(&frame.pointer, entry_key);
            let entry_layer_pointer = child_pointer(&frame.layer_pointer, entry_key);

            if LEAF_MAPS.contains(&frame.pointer.as_str()) {
                self.clear(&entry_pointer, frame.object.get(entry_key))?;

                let copied = self.copy(entry_value)?;

                frame.object.insert(entry_key.clone(), copied);
                self.winners.insert(
                    entry_pointer,
                    origin_of(&layer_build.layer, &entry_layer_pointer),
                );
                frames.push(frame);

                continue;
            }

            let nested = self.setting_step(
                layer_build,
                &mut frame.object,
                entry_key,
                entry_value,
                &entry_pointer,
                &entry_layer_pointer,
            )?;

            frames.push(frame);
            frames.extend(nested);
        }

        // Only a spent budget leaves frames: their objects go back where they were taken from.
        while let Some(done) = frames.pop() {
            check_in(&mut frames, parent, done);
        }

        Ok(())
    }

    /// One step of [`Self::setting`]: settles the value at `key` of `parent`, or takes the merged
    /// object out of `parent` and returns it as a frame when both sides are filled mappings.
    fn setting_step<'layer>(
        &mut self,
        layer_build: &LayerBuild,
        parent: &mut JsonObject,
        key: &str,
        value: &'layer JsonValue,
        pointer: &str,
        layer_pointer: &str,
    ) -> Result<Option<MergeFrame<'layer>>, InternalError> {
        let Some(current) = parent.get(key) else {
            let copied = self.copy(value)?;

            parent.insert(key.to_owned(), copied);
            self.record(value, pointer, &layer_build.layer, layer_pointer)?;

            return Ok(None);
        };

        match (current, value) {
            (JsonValue::Object(current_members), JsonValue::Object(value_members)) => {
                // An empty mapping is a leaf: a later empty one wins it, a later filled one
                // replaces it by its own leaves.
                if value_members.is_empty() {
                    if current_members.is_empty() {
                        self.winners.insert(
                            pointer.to_owned(),
                            origin_of(&layer_build.layer, layer_pointer),
                        );
                    }

                    return Ok(None);
                }

                self.winners.remove(pointer);

                let Some(JsonValue::Object(object)) =
                    parent.insert(key.to_owned(), JsonValue::Null)
                else {
                    return Err(InternalError::new(format!(
                        "'{key}' of the merged tree stopped being an object while it was taken"
                    )));
                };

                Ok(Some(MergeFrame {
                    object,
                    key: key.to_owned(),
                    pointer: pointer.to_owned(),
                    layer_pointer: layer_pointer.to_owned(),
                    entries: value_members.iter(),
                }))
            }
            (JsonValue::Array(_), JsonValue::Array(value_items))
                if UNION_LISTS.contains(&pointer) =>
            {
                self.extend_union(
                    layer_build,
                    parent,
                    key,
                    value_items,
                    pointer,
                    layer_pointer,
                )?;

                Ok(None)
            }
            _ => {
                self.clear(pointer, Some(current))?;

                let copied = self.copy(value)?;

                parent.insert(key.to_owned(), copied);
                self.record(value, pointer, &layer_build.layer, layer_pointer)?;

                Ok(None)
            }
        }
    }

    /// Extends the merged list at `key` with the members of `value_items` it does not hold yet.
    ///
    /// The merged list is extended in place; the members seen so far are kept per union, so each
    /// is serialised once per api. A list is a leaf: its one origin moves to this layer.
    fn extend_union(
        &mut self,
        layer_build: &LayerBuild,
        parent: &mut JsonObject,
        key: &str,
        value_items: &[JsonValue],
        pointer: &str,
        layer_pointer: &str,
    ) -> Result<(), InternalError> {
        let Some(JsonValue::Array(merged_items)) = parent.get_mut(key) else {
            return Err(InternalError::new(format!(
                "'{key}' of the merged tree is not a list"
            )));
        };
        let mut seen = match self.unions.remove(pointer) {
            Some(seen) => seen,
            None => self.members_seen(merged_items)?,
        };

        for item in value_items {
            let identity = json_stringify(item);

            if !self.charge(load_work_of(&identity))? {
                break;
            }

            if seen.contains(&identity) {
                continue;
            }

            seen.insert(identity);
            merged_items.push(self.copy(item)?);
        }

        self.unions.insert(pointer.to_owned(), seen);
        self.winners.insert(
            pointer.to_owned(),
            origin_of(&layer_build.layer, layer_pointer),
        );

        Ok(())
    }

    fn members_seen(
        &mut self,
        merged_items: &[JsonValue],
    ) -> Result<HashSet<String>, InternalError> {
        let mut seen = HashSet::new();

        for item in merged_items {
            let identity = json_stringify(item);

            if !self.charge(load_work_of(&identity))? {
                break;
            }

            seen.insert(identity);
        }

        Ok(seen)
    }

    /// Merges one layer's tree into `merged`, key by key.
    fn merge_layer(
        &mut self,
        layer_build: &LayerBuild,
        merged: &mut JsonObject,
    ) -> Result<(), InternalError> {
        for (key, value) in &layer_build.tree {
            if self.budget.exhausted() {
                break;
            }

            if DIRECTIVE_KEYS.contains(&key.as_str()) {
                continue;
            }

            let pointer = child_pointer("", key);

            self.here = site_at(layer_build, &pointer);

            match value {
                JsonValue::Object(section) if DECLARATION_SECTIONS.contains(&key.as_str()) => {
                    self.merge_declarations(layer_build, merged, key, section, &pointer)?;
                }
                JsonValue::Object(section) if key == "extensions" => {
                    self.merge_extensions(layer_build, merged, key, section, &pointer)?;
                }
                JsonValue::Array(entries) if key == "derive" => {
                    self.merge_derive_entries(layer_build, merged, entries)?;
                }
                _ => self.setting(layer_build, merged, key, value, &pointer, &pointer)?,
            }
        }

        Ok(())
    }

    fn merge_declarations(
        &mut self,
        layer_build: &LayerBuild,
        merged: &mut JsonObject,
        key: &str,
        section: &JsonObject,
        pointer: &str,
    ) -> Result<(), InternalError> {
        let target = self.ensure(merged, key, pointer)?;
        let what = if key == "formats" { "format" } else { key };

        for (name, value) in section {
            if self.budget.exhausted() {
                break;
            }

            let declared_pointer = child_pointer(pointer, name);

            self.declare(layer_build, target, name, value, &declared_pointer, what)?;
        }

        Ok(())
    }

    fn merge_extensions(
        &mut self,
        layer_build: &LayerBuild,
        merged: &mut JsonObject,
        key: &str,
        section: &JsonObject,
        pointer: &str,
    ) -> Result<(), InternalError> {
        let target = self.ensure(merged, key, pointer)?;

        for (prefix, prefix_value) in section {
            if self.budget.exhausted() {
                break;
            }

            let prefix_pointer = child_pointer(pointer, prefix);

            let JsonValue::Object(keys) = prefix_value else {
                self.declare(
                    layer_build,
                    target,
                    prefix,
                    prefix_value,
                    &prefix_pointer,
                    "extension prefix",
                )?;

                continue;
            };
            let inner = self.ensure(target, prefix, &prefix_pointer)?;
            let what = format!("extension '{prefix}'");

            for (name, value) in keys {
                if self.budget.exhausted() {
                    break;
                }

                let declared_pointer = child_pointer(&prefix_pointer, name);

                self.declare(layer_build, inner, name, value, &declared_pointer, &what)?;
            }
        }

        Ok(())
    }

    /// The `derive` entries are declarations by their `entry` name, and merge in layer order.
    fn merge_derive_entries(
        &mut self,
        layer_build: &LayerBuild,
        merged: &mut JsonObject,
        entries: &[JsonValue],
    ) -> Result<(), InternalError> {
        if !matches!(merged.get("derive"), Some(JsonValue::Array(_))) {
            merged.insert("derive".to_owned(), JsonValue::Array(Vec::new()));
        }

        let Some(JsonValue::Array(target)) = merged.get_mut("derive") else {
            return Err(InternalError::new(
                "'derive' of the merged tree is not a list",
            ));
        };

        for (index, entry) in entries.iter().enumerate() {
            if self.budget.exhausted() {
                break;
            }

            let entry_name = match entry {
                JsonValue::Object(members) => match members.get("entry") {
                    Some(JsonValue::String(name)) => Some(name),
                    _ => None,
                },
                _ => None,
            };
            let identity = entry_name.map(|name| format!("/derive#{name}"));
            let at = site_at(layer_build, &format!("/derive/{index}"));

            if let (Some(name), Some(identity)) = (entry_name, &identity)
                && let Some(owner) = self.owners.get(identity)
            {
                let message = derive_twice_message(layer_build, owner, name);
                let fix = if owner.layer == layer_build.layer.to_string() {
                    "rename one of the two entries"
                } else {
                    "remove the copy, or rename one entry"
                };
                let first_at = owner.at;

                self.report_declaration_twice(message, fix, at, first_at)?;

                continue;
            }

            if let Some(identity) = identity {
                self.owners.insert(
                    identity,
                    DeclarationOwner {
                        layer: layer_build.layer.to_string(),
                        file: layer_build.parsed.path.clone(),
                        at,
                        source: None,
                    },
                );
            }

            let merged_pointer = format!("/derive/{}", target.len());

            target.push(self.copy(entry)?);
            self.record(
                entry,
                &merged_pointer,
                &layer_build.layer,
                &format!("/derive/{index}"),
            )?;
        }

        Ok(())
    }

    /// The origin of each leaf of the merged tree, in the tree's own order.
    fn leaf_origins_of(
        &mut self,
        merged: &JsonObject,
    ) -> Result<IndexMap<String, Origin>, InternalError> {
        let mut leaf_origins = IndexMap::new();
        let mut collect = |composer: &mut Self, pointer: &str| {
            if let Some(origin) = composer.winners.get(pointer) {
                leaf_origins.insert(pointer.to_owned(), origin.clone());
            }
        };

        if self.charge(load_work_of(""))? {
            collect(self, "");

            let mut pending = Vec::new();

            push_members(&mut pending, "", merged);
            self.walk_pointers(pending, &mut collect)?;
        }

        Ok(leaf_origins)
    }
}

/// ADR 0002 section 2, clarified: an entry name is unique across every layer.
fn derive_twice_message(layer_build: &LayerBuild, owner: &DeclarationOwner, name: &str) -> String {
    let layer_text = layer_build.layer.to_string();
    let path = &layer_build.parsed.path;
    let place = if owner.layer != layer_text {
        format!(
            "declared by both '{}' ({}) and '{layer_text}' ({path})",
            owner.layer, owner.file
        )
    } else if let FileLayer::Api(ApiLayer::Pack(pack)) = &layer_build.layer {
        format!("declared twice in the pack '{pack}'")
    } else {
        format!("declared twice in '{path}'")
    };

    format!("derive entry '{name}' is {place}, and an entry name is unique across every layer")
}

#[cfg(test)]
mod tests;
