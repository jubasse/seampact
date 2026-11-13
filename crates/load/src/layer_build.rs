//! What expanding one layer file builds: the type `expand`, `compose` and the loader share.

use std::rc::Rc;

use indexmap::IndexMap;
use seampact_authoring::FileLayer;
use seampact_json::JsonObject;
use seampact_span::Span;

use crate::source::ParsedFile;
use crate::yaml::YamlPair;

/// A use of a file element: the name it is declared as, where it is used and the pointer of the
/// use in the layer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefUse {
    /// The element's name.
    pub name: String,
    /// Where the use is written.
    pub at: Span,
    /// The layer pointer of the use.
    pub pointer: String,
}

/// A named element of a file, reached by the file form of `$ref` or by an `$include` under
/// `schemas`.
#[derive(Debug, Clone)]
pub struct FileRef {
    /// The element's identity, `<real path>#<pointer in the file>`.
    pub id: String,
    /// The element's name.
    pub name: String,
    /// The file that declares it.
    pub file: Rc<ParsedFile>,
    /// The index of its pair among the pairs of the file's root mapping.
    pub pair_index: usize,
    /// Where it is reached from.
    pub at: Span,
}

impl FileRef {
    /// The pair the element is declared by: `None` when the file has no root mapping or no such
    /// pair.
    #[must_use]
    pub fn pair(&self) -> Option<&YamlPair> {
        match &self.file.root.as_ref()?.kind {
            crate::yaml::YamlKind::Mapping(pairs) => pairs.get(self.pair_index),
            _ => None,
        }
    }
}

/// One layer file, expanded. `locs` maps a layer pointer to where it is written.
#[derive(Debug, Clone)]
pub struct LayerBuild {
    /// The layer the file is.
    pub layer: FileLayer,
    /// The file the layer was read from.
    pub parsed: Rc<ParsedFile>,
    /// The expanded tree.
    pub tree: JsonObject,
    /// Layer pointer to where it is written.
    pub locs: IndexMap<String, Span>,
    /// Every use of a file element, in order.
    pub uses: Vec<RefUse>,
    /// The file elements the layer reaches, by identity.
    pub refs: IndexMap<String, FileRef>,
    /// Refs added since `finish_refs` last looked, in order.
    pub pending_refs: Vec<FileRef>,
    /// The file element each schema came from (`/schemas/<name>` to `<real path>#<pointer>`), for
    /// those declared by an `$include` under `schemas` or by a file `$ref`. One element reached
    /// from two places, or from two layers, is one declaration (ADR 0002 section 2).
    pub sources: IndexMap<String, String>,
}
