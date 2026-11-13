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
            // Each target is charged before anything is resolved, an empty file or a bad item too.
            let target = item.and_then(|node| string_of(node).map(|raw| (node, raw)));
            let charged_text = target.as_ref().map_or("", |(_, raw)| raw.as_str());

            if !self.charge(load_work_of(charged_text), || node_span(file, item))? {
                return Ok(());
            }

            let Some((target_node, raw)) = target else {
                self.shape(file, item, "$include")?;

                continue;
            };
            let at = node_span(file, Some(target_node));

            if scope.stack.len() >= LOAD_MAX_DEPTH {
                return self.report_too_deep(at);
            }

            let Some((resolved, parsed)) = self.include_target(scope, &raw, at)? else {
                continue;
            };
            let fragment = resolved.fragment.as_deref();
            let Some(target_root) = self.navigate(&parsed, fragment) else {
                let Some(fragment) = fragment else {
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
                )?;

                continue;
            };
            let YamlKind::Mapping(target_pairs) = &target_root.kind else {
                self.report(
                    LoadRule::IncludeShape,
                    format!("'{raw}' does not hold a mapping, and $include merges a mapping"),
                    "include a file or pointer that holds a mapping",
                    at,
                )?;

                continue;
            };

            // Keyed on the real path: a directory link back into the tree is the same file.
            let key = format!("{}#{}", resolved.real, fragment.unwrap_or(""));
            let shown = shown_target(&resolved.path, fragment);

            if let Some(first) = scope.stack.iter().position(|entry| entry.key == key) {
                self.report_include_cycle(scope, first, &shown, at)?;

                continue;
            }

            let kind = self.positions.position_fragment_kind(scope.pos.as_ref());
            let located = self.location_of(at)?;

            self.fragments.push(LoadFragment {
                file: resolved.path.clone(),
                pointer: resolved.fragment.clone(),
                kind,
                at: located,
            });

            let start = seen.0.len();
            let inner = Scope {
                file: parsed.clone(),
                data: false,
                pos: scope.pos.clone(),
                parent_key: scope.parent_key.clone(),
                stack: scope.stack_with(StackEntry {
                    key: key.clone(),
                    shown,
                    at,
                }),
                depth: scope.depth,
            };

            self.items(build, target_pairs, pointer, &inner, out, seen)?;

            if pointer == SCHEMAS_POINTER {
                record_schema_sources(build, seen, start, &key);
            }
        }

        Ok(())
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
