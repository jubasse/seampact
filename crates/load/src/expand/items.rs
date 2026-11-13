//! The keys of one mapping, written in a file or brought by an `$include`.

use std::rc::Rc;

use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue, escape_pointer};
use seampact_span::Span;

use super::mapping_index::MappingIndex;
use super::{Expander, MapKeys, Scope};
use crate::budget::utf16_length;
use crate::json::is_reserved_key;
use crate::layer_build::LayerBuild;
use crate::positions::{MapView, Position, ScalarRead, StepKind};
use crate::report::{LoadRule, PendingDiagnostic, RelatedSite};
use crate::source::{ParsedFile, node_span, pair_span};
use crate::yaml::{YamlNode, YamlPair};

use super::mapping_index::key_string;

/// What the keys of a mapping say about it, to choose among the conditional branches of a schema.
struct KeysView<'index> {
    index: &'index MappingIndex,
    open: bool,
}

impl MapView for KeysView<'_> {
    fn has(&self, key: &str) -> bool {
        self.index.has(key)
    }

    fn scalar(&self, key: &str) -> ScalarRead<'_> {
        match self.index.scalar_of(key) {
            Some(value) => ScalarRead::Scalar(value),
            None => ScalarRead::NotScalar,
        }
    }

    fn open(&self) -> bool {
        self.open
    }
}

impl Expander<'_, '_> {
    pub(super) fn items(
        &mut self,
        build: &mut LayerBuild,
        pairs: &[YamlPair],
        pointer: &str,
        scope: &Scope,
        out: &mut JsonObject,
        seen: &mut MapKeys,
    ) -> Result<(), InternalError> {
        let file = &scope.file;
        let mut include_site: Option<Span> = None;
        // Which conditional branches of the schema this mapping's keys decide (a node with `method`
        // is a route). Keys an include may bring are not seen here, so the view is open then.
        let index = self.mapping_index(pairs);
        let view = KeysView {
            index: &index,
            open: scope.stack.len() > 1 || index.has("$include"),
        };
        let here = if scope.data {
            None
        } else {
            self.positions.refine_position(scope.pos.as_ref(), &view)
        };

        for pair in pairs {
            // Every pair counts, `$include` ones too: a chain of includes builds nothing else.
            if !self.admit(file, Some(&pair.key), scope.depth, pointer)? {
                return Ok(());
            }

            let key_node = &pair.key;
            let value_node = pair.value.as_ref();
            let key = key_string(key_node);

            if let Some(key) = &key
                && !self.charge_text(utf16_length(key), || node_span(file, Some(key_node)))?
            {
                return Ok(());
            }

            let Some(key) = key else {
                self.report(
                    LoadRule::KeyNotScalar,
                    "a mapping key must be a plain or quoted string".to_owned(),
                    "write the key as a string",
                    node_span(file, Some(key_node)),
                )?;

                continue;
            };

            if is_reserved_key(&key) {
                self.reserved(file, Some(key_node), &key)?;

                continue;
            }

            if key == "$include" && !scope.data {
                // P7 holds for the directive too; `seen` cannot tell, as the included keys join it.
                let site = node_span(file, Some(key_node));

                if let Some(first) = include_site {
                    self.report_with_related(
                        PendingDiagnostic::new(
                            LoadRule::DuplicateKey,
                            "key '$include' is defined twice in the same mapping (P7)".to_owned(),
                            "write one $include with a list of paths".to_owned(),
                            site,
                        ),
                        vec![first_defined_here(first)],
                    )?;

                    continue;
                }

                include_site = Some(site);
                self.include(build, pair, pointer, scope, out, seen)?;

                continue;
            }

            let key_site = node_span(file, Some(key_node));

            if let Some(first) = seen.0.get(&key).copied() {
                self.report_with_related(
                    PendingDiagnostic::new(
                        LoadRule::DuplicateKey,
                        format!("key '{key}' is defined twice in the same mapping (P7)"),
                        "remove the duplicate".to_owned(),
                        key_site,
                    ),
                    vec![first_defined_here(first)],
                )?;

                continue;
            }

            seen.0.insert(key.clone(), key_site);

            let child = format!("{pointer}/{}", escape_pointer(&key));
            let pos = if scope.data {
                None
            } else {
                self.positions
                    .step_position(here.as_ref(), &key, StepKind::Key)?
            };
            let child_scope = Scope {
                data: scope.data || pos.as_ref().is_some_and(Position::is_data),
                pos,
                parent_key: Some(Rc::from(key.as_str())),
                depth: scope.depth + 1,
                ..scope.clone()
            };
            let mut value = self.node(build, value_node, &child, &child_scope)?;

            if key == "$ref"
                && !scope.data
                && let JsonValue::String(text) = &value
            {
                value =
                    JsonValue::String(self.file_reference(build, text, value_node, &child, scope)?);
            }

            out.insert(key, value);
            build
                .locs
                .insert(child, pair_span(file, Some(key_node), value_node));
        }

        Ok(())
    }

    pub(super) fn reserved(
        &mut self,
        file: &ParsedFile,
        node: Option<&YamlNode>,
        key: &str,
    ) -> Result<(), InternalError> {
        self.report(
            LoadRule::ReservedKey,
            format!(
                "'{key}' cannot be a key: it names a property every JavaScript object inherits"
            ),
            "rename the key",
            node_span(file, node),
        )
    }
}

fn first_defined_here(at: Span) -> RelatedSite {
    RelatedSite {
        at,
        message: "first defined here".to_owned(),
    }
}
