//! A mapping's pairs by key, and the readings built on them: `keyString`, `mapIndex`, `navigate`.

use std::collections::HashMap;
use std::rc::Rc;

use seampact_js::array_index_value;
use seampact_json::JsonValue;

use super::Expander;
use crate::paths::pointer_segments;
use crate::source::ParsedFile;
use crate::yaml::{YamlKind, YamlNode, YamlPair};

/// The first pair of each key of one mapping, and what a scalar value of it resolves to.
#[derive(Debug, Default)]
pub struct MappingIndex {
    entries: HashMap<String, IndexedPair>,
}

#[derive(Debug)]
struct IndexedPair {
    pair: usize,
    /// The resolved value of a scalar value; `None` for a mapping, a list, an alias or no value.
    scalar: Option<JsonValue>,
}

impl MappingIndex {
    fn of(pairs: &[YamlPair]) -> Self {
        let mut entries: HashMap<String, IndexedPair> = HashMap::new();

        for (position, pair) in pairs.iter().enumerate() {
            let Some(key) = key_string(&pair.key) else {
                continue;
            };

            entries.entry(key).or_insert_with(|| IndexedPair {
                pair: position,
                scalar: pair
                    .value
                    .as_ref()
                    .and_then(YamlNode::resolved_scalar)
                    .map(crate::ResolvedScalar::into_json_value),
            });
        }

        Self { entries }
    }

    /// The position among the mapping's pairs of the first pair written with `key`.
    #[must_use]
    pub fn pair_index(&self, key: &str) -> Option<usize> {
        self.entries.get(key).map(|entry| entry.pair)
    }

    /// Whether some pair is written with `key`.
    #[must_use]
    pub fn has(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    /// The resolved value of the first pair of `key`, when it is a scalar.
    pub(super) fn scalar_of(&self, key: &str) -> Option<&JsonValue> {
        self.entries.get(key)?.scalar.as_ref()
    }
}

/// The text a scalar key is written as: the source for a plain scalar, else the value's JavaScript
/// text. `None` for a key that is not a scalar.
#[must_use]
pub fn key_string(node: &YamlNode) -> Option<String> {
    let YamlKind::Scalar { value, .. } = &node.kind else {
        return None;
    };

    if node.is_plain_scalar() {
        return Some(value.clone());
    }

    node.resolved_scalar()
        .map(|resolved| resolved.to_js_string())
}

/// `path` or `path#fragment`, as a message names a target.
pub(super) fn shown_target(path: &str, fragment: Option<&str>) -> String {
    match fragment {
        Some(fragment) if !fragment.is_empty() => format!("{path}#{fragment}"),
        _ => path.to_owned(),
    }
}

impl Expander<'_, '_> {
    /// A mapping's pairs by key (the first of a duplicated key, as a scan finds it), built once per
    /// mapping: a lookup by name never rescans a large file for each site that names an element.
    ///
    /// A mapping is told apart by where its pairs live in memory: every parsed file is kept by the
    /// store for the whole load, so a node's address is its identity.
    pub fn mapping_index(&mut self, pairs: &[YamlPair]) -> Rc<MappingIndex> {
        if pairs.is_empty() {
            return Rc::new(MappingIndex::default());
        }

        let identity = pairs.as_ptr().addr();

        Rc::clone(
            self.mapping_indexes
                .entry(identity)
                .or_insert_with(|| Rc::new(MappingIndex::of(pairs))),
        )
    }

    /// The node `fragment` (a JSON Pointer) points at in `file`: its root when there is no
    /// fragment. `None` when it points at nothing.
    ///
    /// A list segment is read as an array index (a canonical decimal): the TypeScript took
    /// `Number(segment)`, which also read `1.0`, ` 1` and `0x1`.
    pub fn navigate<'file>(
        &mut self,
        file: &'file ParsedFile,
        fragment: Option<&str>,
    ) -> Option<&'file YamlNode> {
        let root = file.root.as_ref()?;
        let Some(fragment) = fragment.filter(|fragment| !fragment.is_empty()) else {
            return Some(root);
        };
        let mut node = root;

        for segment in pointer_segments(fragment)? {
            node = match &node.kind {
                YamlKind::Mapping(pairs) => {
                    let index = self.mapping_index(pairs);
                    let position = index.pair_index(&segment)?;

                    pairs.get(position)?.value.as_ref()?
                }
                YamlKind::Sequence(items) => {
                    items.get(usize::try_from(array_index_value(&segment)?).ok()?)?
                }
                YamlKind::Scalar { .. } | YamlKind::Alias(_) => return None,
            };
        }

        Some(node)
    }
}
