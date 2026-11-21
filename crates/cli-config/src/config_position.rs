//! A parsed config file and where its keys sit: the `file:line:col key.path` of a problem.

use camino::Utf8Path;
use seampact_diagnostics::InternalError;
use seampact_js::FiniteNumber;
use seampact_load::ResolvedScalar;
use seampact_load::yaml::{YamlDocument, YamlKind, YamlNode, YamlPair};
use seampact_span::{FileId, SourceFiles, Span, TextSize};

use crate::config_kind::ConfigKind;
use crate::key_path::{KeyPath, KeyPathSegment, format_key_path};

/// One config file, parsed: its YAML tree and the table that turns offsets into lines.
#[derive(Debug, Clone)]
pub(crate) struct ParsedConfig {
    pub(crate) document: YamlDocument,
    pub(crate) files: SourceFiles,
    pub(crate) file: FileId,
    pub(crate) display_name: String,
    pub(crate) kind: ConfigKind,
}

impl ParsedConfig {
    /// `<file>:<line>:<col> <key path>` of the key at `path`; the file alone for an empty path of an empty file.
    pub(crate) fn where_of(&self, path: &[KeyPathSegment]) -> Result<String, InternalError> {
        let offset = self.key_offset(path);
        let key_path = if path.is_empty() {
            String::new()
        } else {
            format!(" {}", format_key_path(path))
        };

        Ok(format!(
            "{}{}{key_path}",
            self.display_name,
            self.position_text(offset)?
        ))
    }

    /// `:<line>:<col>` of a byte offset, empty without one.
    pub(crate) fn position_text(&self, offset: Option<TextSize>) -> Result<String, InternalError> {
        let Some(offset) = offset else {
            return Ok(String::new());
        };
        let span = Span::new(self.file, offset, offset);
        let location = self
            .files
            .location(span)
            .ok_or_else(|| InternalError::new("a YAML offset outside its file"))?;

        Ok(format!(":{}:{}", location.line, location.column))
    }

    /// The offset of the key written at `path`, else of the value there.
    fn key_offset(&self, path: &[KeyPathSegment]) -> Option<TextSize> {
        let root = self.document.root.as_ref();
        let (last, parent_path) = match path.split_last() {
            Some((last, parent_path)) => (Some(last), parent_path),
            None => (None, path),
        };

        if let (Some(KeyPathSegment::Key(name)), Some(parent)) = (last, node_at(root, parent_path))
            && let YamlKind::Mapping(pairs) = &parent.kind
            && let Some(pair) = pairs.iter().find(|pair| key_is_text(pair, name))
        {
            return Some(pair.key.span.range.start());
        }

        node_at(root, path).map(|node| node.span.range.start())
    }
}

// `getIn` of the `yaml` package: collections only; an alias ends the walk.
fn node_at<'tree>(
    root: Option<&'tree YamlNode>,
    path: &[KeyPathSegment],
) -> Option<&'tree YamlNode> {
    let mut node = root?;

    for segment in path {
        node = child_of(node, segment)?;
    }

    Some(node)
}

fn child_of<'tree>(node: &'tree YamlNode, segment: &KeyPathSegment) -> Option<&'tree YamlNode> {
    match (&node.kind, segment) {
        (YamlKind::Mapping(pairs), KeyPathSegment::Key(name)) => pairs
            .iter()
            .find(|pair| key_is_text(pair, name))
            .and_then(|pair| pair.value.as_ref()),
        (YamlKind::Mapping(pairs), KeyPathSegment::Index(number)) => pairs
            .iter()
            .find(|pair| key_is_number(pair, *number))
            .and_then(|pair| pair.value.as_ref()),
        (YamlKind::Sequence(items), KeyPathSegment::Index(number)) => list_item(items, *number),
        (YamlKind::Sequence(_), KeyPathSegment::Key(_))
        | (YamlKind::Scalar { .. } | YamlKind::Alias(_), _) => None,
    }
}

fn list_item(items: &[YamlNode], number: FiniteNumber) -> Option<&YamlNode> {
    let position = number.get();

    if position.fract() != 0.0 || position < 0.0 {
        return None;
    }

    items.iter().enumerate().find_map(|(index, item)| {
        let index_number = FiniteNumber::from_i64(i64::try_from(index).ok()?);

        (index_number == number).then_some(item)
    })
}

// A key whose resolved value is this string: a quoted `"200"` is, a plain `200` is not.
fn key_is_text(pair: &YamlPair, name: &str) -> bool {
    matches!(pair.key.resolved_scalar(), Some(ResolvedScalar::String(text)) if text == name)
}

#[expect(clippy::float_cmp, reason = "JavaScript === on two numbers")]
fn key_is_number(pair: &YamlPair, number: FiniteNumber) -> bool {
    matches!(pair.key.resolved_scalar(), Some(ResolvedScalar::Number(key)) if key.to_f64() == number.get())
}

/// The key path of a sub-path used by the problems of one entry: `["targets", index, name]`.
pub(crate) fn entry_path(index: usize, name: &str) -> KeyPath {
    vec![
        KeyPathSegment::key("targets"),
        KeyPathSegment::position(index),
        KeyPathSegment::key(name),
    ]
}

impl ParsedConfig {
    /// The directory-less file name problems name the config by.
    pub(crate) fn display_path(&self) -> &Utf8Path {
        Utf8Path::new(&self.display_name)
    }
}
