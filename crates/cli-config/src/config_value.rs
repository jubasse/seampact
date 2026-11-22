//! The JavaScript value of a config's YAML tree: `Document.toJS()` of the `yaml` package.

use std::collections::HashMap;

use seampact_js::js_key_order;
use seampact_json::{JsonObject, JsonValue, stringify_json};
use seampact_load::ResolvedScalar;
use seampact_load::yaml::{YamlKind, YamlNode, YamlPair};

/// The most aliases one document may expand, as the `yaml` package's `maxAliasCount`.
const MAX_ALIAS_COUNT: u64 = 100;

/// Why a tree has no value: what the `yaml` package throws as a `ReferenceError`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConfigValueError {
    /// An alias names an anchor that no earlier node sets.
    UnresolvedAlias(String),
    /// More aliases than [`MAX_ALIAS_COUNT`].
    ExcessiveAliases,
}

impl ConfigValueError {
    /// The one-line message of the thrown error.
    pub(crate) fn message(&self) -> String {
        match self {
            Self::UnresolvedAlias(name) => {
                format!("Unresolved alias (the anchor must be set before the alias): {name}")
            }
            Self::ExcessiveAliases => {
                "Excessive alias count indicates a resource exhaustion attack".to_owned()
            }
        }
    }
}

/// The value of the document's root: `null` for an empty document.
pub(crate) fn config_value(root: Option<&YamlNode>) -> Result<JsonValue, ConfigValueError> {
    let Some(root) = root else {
        return Ok(JsonValue::Null);
    };
    Expansion::default().value_of(root)
}

/// An anchored node and what the `yaml` package tracks to bound its aliases.
struct Anchor<'tree> {
    node: &'tree YamlNode,
    value: JsonValue,
    /// Starts at 1, as the package's anchor table does; each alias adds one.
    count: u64,
    /// The weight of the node, computed at its first alias; 0 until then.
    alias_count: u64,
}

#[derive(Default)]
struct Expansion<'tree> {
    anchored: HashMap<String, Anchor<'tree>>,
}

impl<'tree> Expansion<'tree> {
    fn value_of(&mut self, node: &'tree YamlNode) -> Result<JsonValue, ConfigValueError> {
        let value = match &node.kind {
            YamlKind::Scalar { .. } => node
                .resolved_scalar()
                .map_or(JsonValue::Null, ResolvedScalar::into_json_value),
            YamlKind::Sequence(items) => JsonValue::Array(
                items
                    .iter()
                    .map(|item| self.value_of(item))
                    .collect::<Result<Vec<_>, _>>()?,
            ),
            YamlKind::Mapping(pairs) => self.mapping_value(pairs)?,
            YamlKind::Alias(name) => return self.alias_value(name.as_str()),
        };

        if let Some(anchor) = &node.anchor {
            self.anchored.insert(
                anchor.as_str().to_owned(),
                Anchor {
                    node,
                    value: value.clone(),
                    count: 1,
                    alias_count: 0,
                },
            );
        }

        Ok(value)
    }

    fn mapping_value(&mut self, pairs: &'tree [YamlPair]) -> Result<JsonValue, ConfigValueError> {
        let mut members = Vec::with_capacity(pairs.len());

        for pair in pairs {
            let key = self.key_text(&pair.key)?;
            let value = match &pair.value {
                Some(node) => self.value_of(node)?,
                None => JsonValue::Null,
            };

            members.push((key, value));
        }

        Ok(JsonValue::Object(
            js_key_order(members).collect::<JsonObject>(),
        ))
    }

    // `stringifyKey` of the `yaml` package: a null key is empty, a collection is its JSON text.
    fn key_text(&mut self, key: &'tree YamlNode) -> Result<String, ConfigValueError> {
        match key.resolved_scalar() {
            Some(ResolvedScalar::Null) => Ok(String::new()),
            Some(resolved) => Ok(resolved.to_js_string()),
            None => Ok(stringify_json(&self.value_of(key)?)),
        }
    }

    // `Alias.toJS` of the `yaml` package: the anchor's count times its weight is bounded.
    fn alias_value(&mut self, name: &str) -> Result<JsonValue, ConfigValueError> {
        let anchor = self
            .anchored
            .get(name)
            .ok_or_else(|| ConfigValueError::UnresolvedAlias(name.to_owned()))?;
        let known_weight = anchor.alias_count;
        let node = anchor.node;
        let weight = if known_weight == 0 {
            alias_weight(node, &self.anchored)
        } else {
            known_weight
        };
        let anchor = self
            .anchored
            .get_mut(name)
            .ok_or_else(|| ConfigValueError::UnresolvedAlias(name.to_owned()))?;

        anchor.count = anchor.count.saturating_add(1);
        anchor.alias_count = weight;

        if anchor.count.saturating_mul(anchor.alias_count) > MAX_ALIAS_COUNT {
            return Err(ConfigValueError::ExcessiveAliases);
        }

        Ok(anchor.value.clone())
    }
}

// `getAliasCount` of the `yaml` package: the largest weight of an alias below the node, else 1.
fn alias_weight(node: &YamlNode, anchored: &HashMap<String, Anchor<'_>>) -> u64 {
    match &node.kind {
        YamlKind::Alias(name) => anchored
            .get(name.as_str())
            .map_or(0, |anchor| anchor.count.saturating_mul(anchor.alias_count)),
        YamlKind::Sequence(items) => items
            .iter()
            .map(|item| alias_weight(item, anchored))
            .max()
            .unwrap_or(0),
        YamlKind::Mapping(pairs) => pairs
            .iter()
            .map(|pair| {
                let value_weight = pair
                    .value
                    .as_ref()
                    .map_or(1, |value| alias_weight(value, anchored));

                alias_weight(&pair.key, anchored).max(value_weight)
            })
            .max()
            .unwrap_or(0),
        YamlKind::Scalar { .. } => 1,
    }
}

#[cfg(test)]
mod tests {
    use seampact_load::yaml::parse_yaml;
    use seampact_span::FileId;

    use super::*;

    fn value_of(text: &str) -> Result<JsonValue, ConfigValueError> {
        let mut files = seampact_span::SourceFiles::new();
        let file: FileId = files.add("config.yaml", text).expect("a small text");
        let document = parse_yaml(file, text).expect("a small text");

        config_value(document.root.as_ref())
    }

    #[test]
    fn integer_keys_come_first_as_javascript_objects_order_them() {
        let value = value_of("b: 1\n\"10\": 2\n\"2\": 3\na: 4\n").expect("a plain mapping");
        let JsonValue::Object(object) = value else {
            panic!("a mapping");
        };
        let keys: Vec<&String> = object.keys().collect();

        assert_eq!(keys, ["2", "10", "b", "a"]);
    }

    #[test]
    fn a_number_key_reads_as_its_javascript_text_and_a_valueless_key_as_null() {
        let value = value_of("{ 1.50: x, lone }\n").expect("a mapping");
        let JsonValue::Object(object) = value else {
            panic!("a mapping");
        };

        assert_eq!(object.get("1.5"), Some(&JsonValue::String("x".to_owned())));
        assert_eq!(object.get("lone"), Some(&JsonValue::Null));
    }

    #[test]
    fn an_alias_reads_as_a_copy_of_its_anchor() {
        let value = value_of("a: &x [1, 2]\nb: *x\n").expect("a mapping");
        let JsonValue::Object(object) = value else {
            panic!("a mapping");
        };

        assert_eq!(object.get("a"), object.get("b"));
    }
}
