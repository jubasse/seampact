//! The file form of `$ref`: a path to a schema file names one element of it.

use std::rc::Rc;

use seampact_diagnostics::InternalError;
use seampact_json::escape_pointer;
use seampact_span::Span;

use super::Expander;
use super::Scope;
use super::mapping_index::key_string;
use crate::LoadFragment;
use crate::json::is_reserved_key;
use crate::layer_build::{FileRef, LayerBuild, RefUse};
use crate::paths::pointer_segments;
use crate::report::LoadRule;
use crate::source::{FileKind, ResolvedFile, node_span};
use crate::yaml::{YamlKind, YamlNode, YamlPair};

/// The kind of every file a file `$ref` names: schema files are name-keyed (ADR 0002 section 2),
/// whatever the `$ref` sits in.
const SCHEMA_FILE_KIND: &str = "schemas";

impl Expander<'_, '_> {
    /// Reads the value of a `$ref` key: a name is a use, a path to a schema file names an element
    /// of it. Returns the value the key holds in the layer's tree.
    pub(super) fn file_reference(
        &mut self,
        build: &mut LayerBuild,
        value: &str,
        value_node: Option<&YamlNode>,
        pointer: &str,
        scope: &Scope,
    ) -> Result<String, InternalError> {
        let file = &scope.file;
        let at = node_span(file, value_node);

        if value.starts_with('#') {
            self.report(
                LoadRule::RefPointer,
                format!(
                    "a pointer into the merged catalogues ('{value}') is refused; the name says the same thing"
                ),
                "write the name: $ref: Task",
                at,
            )?;

            return Ok(value.to_owned());
        }

        if !is_path(value) {
            build.uses.push(RefUse {
                name: value.to_owned(),
                at,
                pointer: pointer.to_owned(),
            });

            return Ok(value.to_owned());
        }

        let Some(resolved) =
            self.store
                .resolve(self.reporter, file.path_context(), value, at, FileKind::Ref)?
        else {
            return Ok(value.to_owned());
        };
        let Some(parsed) = self
            .store
            .parse(self.reporter, &resolved.path, &file.boundary)?
        else {
            return Ok(value.to_owned());
        };
        let Some(root) = &parsed.root else {
            return Ok(value.to_owned());
        };
        let YamlKind::Mapping(pairs) = &root.kind else {
            self.report(
                LoadRule::RefFileShape,
                format!("'{value}' does not hold a mapping of names to schemas"),
                "write the file as Name: { ...schema }",
                at,
            )?;

            return Ok(value.to_owned());
        };
        let NamedElement::Named(name) = self.element_name(&resolved, pairs, at)? else {
            return Ok(value.to_owned());
        };

        if let Some(name) = &name
            && is_reserved_key(name)
        {
            self.reserved(file, value_node, name)?;

            return Ok(value.to_owned());
        }

        let index = self.mapping_index(pairs);
        let element = name
            .as_deref()
            .and_then(|name| index.pair_index(name).map(|position| (name, position)));
        let Some((name, pair_index)) = element else {
            self.report(
                LoadRule::RefFragment,
                format!(
                    "'{}' declares no element '{}'",
                    resolved.path,
                    name.as_deref().unwrap_or("")
                ),
                "point at an element the file declares",
                at,
            )?;

            return Ok(value.to_owned());
        };

        self.push_schema_fragment(&resolved.path, resolved.fragment.clone(), at)?;

        let id = format!("{}#/{}", resolved.real, escape_pointer(name));

        if !build.refs.contains_key(&id) {
            let reference = FileRef {
                id: id.clone(),
                name: name.to_owned(),
                file: Rc::clone(&parsed),
                pair_index,
                at,
            };

            build.refs.insert(id, reference.clone());
            build.pending_refs.push(reference);
        }

        Ok(name.to_owned())
    }

    /// The name a file `$ref` points at: the one its pointer holds, or the only element of the
    /// file.
    fn element_name(
        &mut self,
        resolved: &ResolvedFile,
        pairs: &[YamlPair],
        at: Span,
    ) -> Result<NamedElement, InternalError> {
        let fragment = resolved
            .fragment
            .as_deref()
            .filter(|fragment| !fragment.is_empty());

        match (fragment, pairs) {
            (Some(fragment), _) => {
                let segments = pointer_segments(fragment);

                let Some([only]) = segments.as_deref() else {
                    self.report(
                        LoadRule::RefFragment,
                        format!(
                            "the pointer '#{fragment}' of $ref must name one element of the file"
                        ),
                        "point at one element, as in $ref: ./schemas/task.yaml#/Task",
                        at,
                    )?;

                    return Ok(NamedElement::Reported);
                };

                Ok(NamedElement::Named(Some(only.clone())))
            }
            (None, [only]) => Ok(NamedElement::Named(key_string(&only.key))),
            (None, _) => {
                self.report(
                    LoadRule::RefFileShape,
                    format!(
                        "'{}' declares {} elements, and a $ref without a pointer needs exactly one",
                        resolved.path,
                        pairs.len()
                    ),
                    "add the element's name: $ref: ./schemas/task.yaml#/Task",
                    at,
                )?;

                Ok(NamedElement::Reported)
            }
        }
    }

    fn push_schema_fragment(
        &mut self,
        path: &str,
        pointer: Option<String>,
        at: Span,
    ) -> Result<(), InternalError> {
        let located = self.location_of(at)?;

        self.fragments.push(LoadFragment {
            file: path.to_owned(),
            pointer,
            kind: Some(SCHEMA_FILE_KIND),
            at: located,
        });

        Ok(())
    }
}

/// What the file `$ref` says it points at.
enum NamedElement {
    /// A name, when the file's only key is a scalar.
    Named(Option<String>),
    /// A diagnostic was reported.
    Reported,
}

/// A `$ref` value is a path when it holds a separator or starts with a drive letter.
fn is_path(value: &str) -> bool {
    let mut characters = value.chars();
    let starts_with_drive = matches!(
        (characters.next(), characters.next()),
        (Some(letter), Some(':')) if letter.is_ascii_alphabetic()
    );

    value.contains('/') || value.contains('\\') || starts_with_drive
}
