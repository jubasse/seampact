//! `$include`: the mappings of other files, merged into the mapping that names them.

use std::rc::Rc;

use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, escape_pointer};
use seampact_span::Span;

use super::mapping_index::shown_target;
use super::{Expander, MapKeys, Scope, StackEntry};
use crate::LoadFragment;
use crate::budget::load_work_of;
use crate::layer_build::LayerBuild;
use crate::limits::LOAD_MAX_DEPTH;
use crate::report::{LoadRule, PendingDiagnostic, RelatedSite};
use crate::scalars::ResolvedScalar;
use crate::source::{FileKind, ParsedFile, ResolvedFile, node_span, pair_span};
use crate::yaml::{YamlKind, YamlNode, YamlPair};

const SCHEMAS_POINTER: &str = "/schemas";

/// What one `$include` item leads to.
enum IncludeStep {
    /// The budget or the depth is spent: no other item is read.
    Stop,
    /// The item was refused and reported.
    Skip,
    /// A mapping to merge.
    Merge(IncludeMerge),
}

/// A mapping found for an `$include`, and how it was reached.
struct IncludeMerge {
    parsed: Rc<ParsedFile>,
    fragment: Option<String>,
    key: String,
    shown: String,
    at: Span,
}

/// The text of a scalar the core schema reads as a string.
pub(super) fn string_of(node: &YamlNode) -> Option<String> {
    match node.resolved_scalar()? {
        ResolvedScalar::String(text) => Some(text),
        _ => None,
    }
}

impl Expander<'_, '_> {
    pub(super) fn include(
        &mut self,
        build: &mut LayerBuild,
        pair: &YamlPair,
        pointer: &str,
        scope: &Scope,
        out: &mut JsonObject,
        seen: &mut MapKeys,
    ) -> Result<(), InternalError> {
        let file = &scope.file;
        let value_node = pair.value.as_ref();
        let site = pair_span(file, Some(&pair.key), value_node);

        if scope.parent_key.as_deref() == Some("routes") {
            return self.report(
                LoadRule::IncludeUnderRoutes,
                "$include cannot be a key of a mapping of named tree nodes (routes)".to_owned(),
                "include the content inside a route, or write the route inline",
                site,
            );
        }

        let items: Vec<Option<&YamlNode>> = match value_node {
            Some(YamlNode {
                kind: YamlKind::Sequence(items),
                ..
            }) => items.iter().map(Some).collect(),
            other => vec![other],
        };

        for item in items {
            match self.include_step(item, scope)? {
                IncludeStep::Stop => return Ok(()),
                IncludeStep::Skip => {}
                IncludeStep::Merge(merge) => {
                    self.merge_include(build, merge, pointer, scope, out, seen)?;
                }
            }
        }

        Ok(())
    }

    /// Everything one `$include` item needs before its mapping is merged: charged, resolved,
    /// parsed, found, checked for a cycle and recorded as a fragment. Kept apart from the merge
    /// so the frames of a chain of includes stay small.
    fn include_step(
        &mut self,
        item: Option<&YamlNode>,
        scope: &Scope,
    ) -> Result<IncludeStep, InternalError> {
        let file = &scope.file;
        // Each target is charged before anything is resolved, an empty file or a bad item too.
        let target = item.and_then(|node| string_of(node).map(|raw| (node, raw)));
        let charged_text = target.as_ref().map_or("", |(_, raw)| raw.as_str());

        if !self.charge(load_work_of(charged_text), || node_span(file, item))? {
            return Ok(IncludeStep::Stop);
        }

        let Some((target_node, raw)) = target else {
            self.shape(file, item, "$include")?;

            return Ok(IncludeStep::Skip);
        };
        let at = node_span(file, Some(target_node));

        if scope.stack.len() >= LOAD_MAX_DEPTH {
            self.report_too_deep(at)?;

            return Ok(IncludeStep::Stop);
        }

        let Some((resolved, parsed)) = self.include_target(scope, &raw, at)? else {
            return Ok(IncludeStep::Skip);
        };
        let fragment = resolved.fragment.as_deref();
        let Some(target_root) = self.navigate(&parsed, fragment) else {
            self.report_include_fragment(&raw, &resolved, at)?;

            return Ok(IncludeStep::Skip);
        };

        if !matches!(target_root.kind, YamlKind::Mapping(_)) {
            self.report(
                LoadRule::IncludeShape,
                format!("'{raw}' does not hold a mapping, and $include merges a mapping"),
                "include a file or pointer that holds a mapping",
                at,
            )?;

            return Ok(IncludeStep::Skip);
        }

        // Keyed on the real path: a directory link back into the tree is the same file.
        let key = format!("{}#{}", resolved.real, fragment.unwrap_or(""));
        let shown = shown_target(&resolved.path, fragment);

        if let Some(first) = scope.stack.iter().position(|entry| entry.key == key) {
            self.report_include_cycle(scope, first, &shown, at)?;

            return Ok(IncludeStep::Skip);
        }

        let kind = self.positions.position_fragment_kind(scope.pos.as_ref());
        let located = self.location_of(at)?;

        self.fragments.push(LoadFragment {
            file: resolved.path.clone(),
            pointer: resolved.fragment.clone(),
            kind,
            at: located,
        });

        Ok(IncludeStep::Merge(IncludeMerge {
            parsed,
            fragment: resolved.fragment,
            key,
            shown,
            at,
        }))
    }

    fn merge_include(
        &mut self,
        build: &mut LayerBuild,
        merge: IncludeMerge,
        pointer: &str,
        scope: &Scope,
        out: &mut JsonObject,
        seen: &mut MapKeys,
    ) -> Result<(), InternalError> {
        let Some(YamlNode {
            kind: YamlKind::Mapping(target_pairs),
            ..
        }) = self.navigate(&merge.parsed, merge.fragment.as_deref())
        else {
            return Err(InternalError::new(
                "an included mapping was found by its step and is gone",
            ));
        };
        let start = seen.0.len();
        let inner = Scope {
            file: Rc::clone(&merge.parsed),
            data: false,
            pos: scope.pos.clone(),
            parent_key: scope.parent_key.clone(),
            stack: scope.stack_with(StackEntry {
                key: merge.key.clone(),
                shown: merge.shown,
                at: merge.at,
            }),
            depth: scope.depth,
        };

        self.items(build, target_pairs, pointer, &inner, out, seen)?;

        if pointer == SCHEMAS_POINTER {
            record_schema_sources(build, seen, start, &merge.key);
        }

        Ok(())
    }

    fn report_include_fragment(
        &mut self,
        raw: &str,
        resolved: &ResolvedFile,
        at: Span,
    ) -> Result<(), InternalError> {
        let Some(fragment) = resolved.fragment.as_deref() else {
            return Err(InternalError::new(
                "navigate found nothing in a file with a root and no fragment",
            ));
        };

        self.report(
            LoadRule::IncludeFragment,
            format!(
                "the pointer '#{fragment}' of '{raw}' matches nothing in '{}'",
                resolved.path
            ),
            "point at an existing mapping, as in ./file.yaml#/Name",
            at,
        )
    }

    /// The file an `$include` path names, resolved and parsed; `None` when it was refused (the
    /// reason is reported) or holds no node.
    fn include_target(
        &mut self,
        scope: &Scope,
        raw: &str,
        at: Span,
    ) -> Result<Option<(ResolvedFile, Rc<ParsedFile>)>, InternalError> {
        let file = &scope.file;
        let Some(resolved) = self.store.resolve(
            self.reporter,
            file.path_context(),
            raw,
            at,
            FileKind::Include,
        )?
        else {
            return Ok(None);
        };
        let Some(parsed) = self
            .store
            .parse(self.reporter, &resolved.path, &file.boundary)?
        else {
            return Ok(None);
        };

        Ok(parsed.root.is_some().then_some((resolved, parsed)))
    }

    fn report_include_cycle(
        &mut self,
        scope: &Scope,
        first: usize,
        shown: &str,
        at: Span,
    ) -> Result<(), InternalError> {
        let cycle: Vec<&StackEntry> = scope.stack.iter().skip(first).collect();
        let names: Vec<&str> = cycle
            .iter()
            .map(|entry| entry.shown.as_str())
            .chain(std::iter::once(shown))
            .collect();
        let related = cycle
            .iter()
            .skip(1)
            .map(|entry| RelatedSite {
                at: entry.at,
                message: format!("'{}' is included here", entry.shown),
            })
            .collect();

        self.report_with_related(
            PendingDiagnostic::new(
                LoadRule::IncludeCycle,
                format!("$include cycle (P8): {}", names.join(" -> ")),
                "break the cycle by removing one $include of it".to_owned(),
                at,
            ),
            related,
        )
    }

    pub(super) fn shape(
        &mut self,
        file: &ParsedFile,
        node: Option<&YamlNode>,
        what: &str,
    ) -> Result<(), InternalError> {
        self.report(
            LoadRule::IncludeShape,
            format!("{what} takes a path, or a list of paths"),
            &format!("write {what}: ./file.yaml or a list of paths"),
            node_span(file, node),
        )
    }
}

/// The schemas an include brought, each to the file element it came from. A nested include
/// recorded its own keys first; those of this file are the rest.
fn record_schema_sources(build: &mut LayerBuild, seen: &MapKeys, start: usize, key: &str) {
    for name in seen.0.keys().skip(start) {
        let declared_at = format!("{SCHEMAS_POINTER}/{}", escape_pointer(name));

        if !build.sources.contains_key(&declared_at) {
            build
                .sources
                .insert(declared_at, format!("{key}/{}", escape_pointer(name)));
        }
    }
}
