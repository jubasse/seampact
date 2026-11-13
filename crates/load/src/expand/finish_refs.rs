//! The schema files reached only through `$ref`, expanded once the layer's names are known.

use std::collections::HashSet;
use std::rc::Rc;

use seampact_authoring::FileLayer;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue, escape_pointer};
use seampact_span::Span;

use super::{Expander, Scope, StackEntry};
use crate::layer_build::{FileRef, LayerBuild};
use crate::report::{LoadRule, PendingDiagnostic, RelatedSite};
use crate::source::pair_span;
use crate::yaml::YamlKind;

const SCHEMAS_KEY: &str = "schemas";

/// How far into the nesting a schema element of a file is expanded: the layer's root and the
/// `schemas` catalogue sit above it.
const ELEMENT_DEPTH: usize = 2;

/// A declaration of a name, in this layer or in one it builds on.
#[derive(Debug, Clone)]
pub struct VisibleDeclaration {
    /// Where the declaration is written.
    pub site: Option<Span>,
    /// The layer that declares it.
    pub layer: FileLayer,
    /// The file element it came from (`<real path>#<pointer>`), when it came from a file.
    pub source: Option<String>,
}

impl Expander<'_, '_> {
    /// Expands the schema files reached only through `$ref`, once the layer's names are known.
    ///
    /// A file `$ref` is read as naming a schema: ADR 0002 section 2 shows it only for schema files
    /// ("schema files are always name-keyed"), so the element joins `schemas`. Another catalogue
    /// reached by file would need the expected catalogue from the authoring schema.
    ///
    /// `visible` tells whether a name is already declared by a layer this one builds on; it is given
    /// the expander, since looking a name up is charged to the load's budget.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when a span is outside its file or the schemas are broken.
    pub fn finish_refs(
        &mut self,
        build: &mut LayerBuild,
        mut visible: impl FnMut(&mut Self, &str) -> Result<Option<VisibleDeclaration>, InternalError>,
    ) -> Result<(), InternalError> {
        // A queue read by a cursor, fed by the refs each expansion adds: no rescan, no shift.
        let mut queue: Vec<FileRef> = Vec::new();
        let mut next = 0;
        let mut queued: HashSet<String> = HashSet::new();

        enqueue_all(build, &mut queue, &mut queued);

        while let Some(reference) = queue.get(next).cloned() {
            next += 1;

            if self.budget.exhausted() {
                return Ok(());
            }

            let pointer = format!("/{SCHEMAS_KEY}/{}", escape_pointer(&reference.name));
            let Some(element) = reference.pair() else {
                return Err(InternalError::new(format!(
                    "the element '{}' of '{}' has no pair",
                    reference.name, reference.file.path
                )));
            };
            let element_site =
                pair_span(&reference.file, Some(&element.key), element.value.as_ref());
            let other = if declares_own(build, &reference.name) {
                Some(VisibleDeclaration {
                    site: build.locs.get(&pointer).copied(),
                    layer: build.layer.clone(),
                    source: build.sources.get(&pointer).cloned(),
                })
            } else {
                visible(self, &reference.name)?
            };

            // The same element, already declared here or by a layer this one builds on (by an
            // include or another `$ref`): the `$ref` points at it.
            if other
                .as_ref()
                .is_some_and(|other| other.source.as_deref() == Some(reference.id.as_str()))
            {
                continue;
            }

            if let Some(other) = other {
                self.report_declared_twice(build, &reference, &other, element_site)?;

                continue;
            }

            let uses_before = build.uses.len();
            let scope = Scope {
                file: Rc::clone(&reference.file),
                data: false,
                pos: self
                    .positions
                    .position_at(build.layer.schema_kind(), &[SCHEMAS_KEY, &reference.name])?,
                parent_key: Some(Rc::from(reference.name.as_str())),
                stack: Rc::new(vec![StackEntry {
                    key: format!(
                        "{}#/{}",
                        self.store.real_of(&reference.file.path),
                        escape_pointer(&reference.name)
                    ),
                    shown: format!(
                        "{}#/{}",
                        reference.file.path,
                        escape_pointer(&reference.name)
                    ),
                    at: element_site,
                }]),
                depth: ELEMENT_DEPTH,
            };
            let value = self.node(build, element.value.as_ref(), &pointer, &scope)?;

            declared_schemas(&mut build.tree)?.insert(reference.name.clone(), value);
            build.locs.insert(pointer.clone(), element_site);
            build.sources.insert(pointer, reference.id.clone());

            // What the element references in its own file comes along with it.
            self.queue_sibling_elements(build, uses_before, &reference, &mut queue, &mut queued);
            enqueue_all(build, &mut queue, &mut queued);
        }

        Ok(())
    }

    fn report_declared_twice(
        &mut self,
        build: &LayerBuild,
        reference: &FileRef,
        other: &VisibleDeclaration,
        at: Span,
    ) -> Result<(), InternalError> {
        let owner = if other.layer == build.layer {
            "this layer".to_owned()
        } else {
            format!("the layer '{}'", other.layer)
        };
        let related = other
            .site
            .map(|site| RelatedSite {
                at: site,
                message: "also declared here".to_owned(),
            })
            .into_iter()
            .collect();

        self.report_with_related(
            PendingDiagnostic::new(
                LoadRule::DeclarationTwice,
                format!(
                    "schema '{}' is declared twice: by '{}' and by {owner}",
                    reference.name, reference.file.path
                ),
                "remove the copy, or use the declared name instead of the file".to_owned(),
                at,
            ),
            related,
        )
    }

    fn queue_sibling_elements(
        &mut self,
        build: &LayerBuild,
        uses_before: usize,
        reference: &FileRef,
        queue: &mut Vec<FileRef>,
        queued: &mut HashSet<String>,
    ) {
        let Some(YamlKind::Mapping(pairs)) = reference.file.root.as_ref().map(|root| &root.kind)
        else {
            return;
        };
        let index = self.mapping_index(pairs);

        for used in build.uses.iter().skip(uses_before) {
            if used.at.file != reference.file.file {
                continue;
            }

            let Some(pair_index) = index.pair_index(&used.name) else {
                continue;
            };
            let id = format!(
                "{}#/{}",
                self.store.real_of(&reference.file.path),
                escape_pointer(&used.name)
            );

            if queued.insert(id.clone()) {
                queue.push(FileRef {
                    id,
                    name: used.name.clone(),
                    file: Rc::clone(&reference.file),
                    pair_index,
                    at: used.at,
                });
            }
        }
    }
}

/// `Object.hasOwn(tree.schemas, name)`: whether the layer's own `schemas` declares the name.
fn declares_own(build: &LayerBuild, name: &str) -> bool {
    matches!(
        build.tree.get(SCHEMAS_KEY),
        Some(JsonValue::Object(schemas)) if schemas.contains_key(name)
    )
}

/// Moves the refs added since the last look into the queue, each element once.
fn enqueue_all(build: &mut LayerBuild, queue: &mut Vec<FileRef>, queued: &mut HashSet<String>) {
    for reference in build.pending_refs.drain(..) {
        if queued.insert(reference.id.clone()) {
            queue.push(reference);
        }
    }
}

/// The layer's `schemas` object, made when it is missing or holds something else.
fn declared_schemas(tree: &mut JsonObject) -> Result<&mut JsonObject, InternalError> {
    if !matches!(tree.get(SCHEMAS_KEY), Some(JsonValue::Object(_))) {
        tree.insert(SCHEMAS_KEY.to_owned(), JsonValue::Object(JsonObject::new()));
    }

    match tree.get_mut(SCHEMAS_KEY) {
        Some(JsonValue::Object(schemas)) => Ok(schemas),
        _ => Err(InternalError::new("the schemas object was just made")),
    }
}
