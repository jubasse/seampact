//! The YAML tree of one file, built from the events of `saphyr-parser`.
//!
//! Where the TypeScript walked the `yaml` package's nodes, the loader walks a [`YamlNode`] tree.
//! A node's [`Span`] is that package's `range[0]..range[1]`: a scalar's value without its anchor
//! or tag, a collection from its first token to the end of its last value, an alias `*name`
//! whole. Keys and values keep their source order, duplicates included.

mod builder;
mod char_offsets;
mod ranges;

use seampact_diagnostics::InternalError;
use seampact_span::{FileId, Span};

use crate::scalars::{ResolvedScalar, resolve_plain_scalar};

const YAML_CORE_TAG_PREFIX: &str = "tag:yaml.org,2002:";

/// An anchor or alias name, as written after the `&` or `*`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct YamlName(String);

impl YamlName {
    pub(crate) fn new(name: String) -> Self {
        Self(name)
    }

    /// The name without its indicator.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// How a scalar was written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScalarStyle {
    /// No quotes: the only style the core schema resolves.
    Plain,
    /// Single or double quotes.
    Quoted,
    /// A `|` or `>` block.
    Block,
}

/// A node of the tree.
#[derive(Debug, Clone, PartialEq)]
pub struct YamlNode {
    /// Where the node is written: its value, not its anchor or tag.
    pub span: Span,
    /// The anchor written before the node.
    pub anchor: Option<YamlName>,
    /// The tag written before the node, with `tag:yaml.org,2002:` as the parser gives it
    /// (`tag:yaml.org,2002:str` for `!!str`).
    pub tag: Option<String>,
    /// What the node is.
    pub kind: YamlKind,
}

/// What a node is.
#[derive(Debug, Clone, PartialEq)]
pub enum YamlKind {
    /// A scalar: `value` is the text after quotes, escapes and line folding.
    Scalar {
        /// The text of the scalar.
        value: String,
        /// How it was written.
        style: ScalarStyle,
    },
    /// A mapping, its pairs in source order, duplicate keys kept.
    Mapping(Vec<YamlPair>),
    /// A sequence.
    Sequence(Vec<YamlNode>),
    /// `*name`.
    Alias(YamlName),
}

/// One key of a mapping and its value; `None` when no value is written (`{a, b}`).
#[derive(Debug, Clone, PartialEq)]
pub struct YamlPair {
    /// The key.
    pub key: YamlNode,
    /// The value, when written.
    pub value: Option<YamlNode>,
}

impl YamlNode {
    /// The tag as the diagnostics show it: `!!str` for the core schema's `str`.
    #[must_use]
    pub fn shown_tag(&self) -> Option<String> {
        self.tag
            .as_ref()
            .map(|tag| tag.replacen(YAML_CORE_TAG_PREFIX, "!!", 1))
    }

    /// Whether the node is a scalar written without quotes or block markers.
    #[must_use]
    pub fn is_plain_scalar(&self) -> bool {
        matches!(
            self.kind,
            YamlKind::Scalar {
                style: ScalarStyle::Plain,
                ..
            }
        )
    }

    /// The scalar's text (the `source` of the `yaml` package), `None` for another kind of node.
    #[must_use]
    pub fn scalar_text(&self) -> Option<&str> {
        match &self.kind {
            YamlKind::Scalar { value, .. } => Some(value),
            _ => None,
        }
    }

    /// What the core schema reads the scalar as (the `value` of the `yaml` package), `None` for
    /// another kind of node.
    ///
    /// A quoted or block scalar is a string. A plain one is resolved by [`resolve_plain_scalar`].
    /// A scalar with a core schema tag (`!!str`, `!!int`, `!!float`, `!!bool`, `!!null`) is that
    /// type when its text is, else a string; any other tag leaves a string. Every tag is refused
    /// by the load (`seampact/load/yaml-tag`), so a tagged value only reaches a tree the load
    /// discards.
    #[must_use]
    pub fn resolved_scalar(&self) -> Option<ResolvedScalar> {
        let YamlKind::Scalar { value, style } = &self.kind else {
            return None;
        };

        if let Some(tag) = &self.tag {
            return Some(resolve_tagged(tag, value));
        }

        match style {
            ScalarStyle::Plain => Some(resolve_plain_scalar(value)),
            ScalarStyle::Quoted | ScalarStyle::Block => Some(ResolvedScalar::String(value.clone())),
        }
    }
}

fn resolve_tagged(tag: &str, value: &str) -> ResolvedScalar {
    let resolved = resolve_plain_scalar(value);
    let agrees = match tag.strip_prefix(YAML_CORE_TAG_PREFIX) {
        Some("null") => resolved == ResolvedScalar::Null,
        Some("bool") => matches!(resolved, ResolvedScalar::Bool(_)),
        Some("int" | "float") => resolved.is_number(),
        _ => false,
    };

    if agrees {
        return resolved;
    }

    ResolvedScalar::String(value.to_owned())
}

/// The first thing that stopped the parse of a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum YamlProblem {
    /// The parser refused the text; it stops at its first error.
    Syntax {
        /// What the parser says.
        info: String,
        /// The error marker.
        at: Span,
    },
    /// The parser refused to nest flow collections deeper.
    TooDeep {
        /// The error marker.
        at: Span,
    },
    /// A second document starts: from its `---` to the end of the text. The first stays the root.
    SecondDocument {
        /// The rest of the text.
        at: Span,
    },
}

/// The tree of a file and what stopped it.
#[derive(Debug, Clone, PartialEq)]
pub struct YamlDocument {
    /// The first document's root, `None` for an empty text or after a syntax error.
    pub root: Option<YamlNode>,
    /// The first problem, which ends the parse.
    pub problem: Option<YamlProblem>,
}

/// Parses `text`, the normalised text of `file`, into a tree.
///
/// The tree keeps nodes down to one level below [`crate::LOAD_MAX_DEPTH`]: a collection at that
/// level has no children, so the walk reports it as too deep and no recursion follows the input.
///
/// # Errors
///
/// [`InternalError`] when the text is longer than a span offset addresses.
pub fn parse_yaml(file: FileId, text: &str) -> Result<YamlDocument, InternalError> {
    builder::parse_document(file, text)
}

#[cfg(test)]
mod tests;
