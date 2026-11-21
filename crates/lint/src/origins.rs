//! Origins as the rules read them: the contract's own elements only, and the node a key is written on.

use indexmap::IndexMap;
use seampact_ir::{Layer, Operation, Origin};
use seampact_span::location_key;

/// Whether the contract wrote the element: a core declaration has no file, a relay copy is linted
/// by its own api.
pub(crate) fn lint_owns_origin(origin: &Origin) -> bool {
    !matches!(origin.layer, Layer::Core) && origin.api.is_none()
}

/// The origin of the node that holds the key `origin` names (`/surfaces/app/routes/tasks/access`
/// gives the route).
///
/// A pointer with no `/` loses its last character, as the TypeScript `slice(0, -1)` does; an
/// astral last character is dropped whole where JavaScript would leave half of it.
pub(crate) fn lint_node_of(origin: &Origin) -> Origin {
    let pointer = if let Some((parent, _)) = origin.pointer.rsplit_once('/') {
        parent.to_owned()
    } else {
        let mut kept = origin.pointer.clone();

        kept.pop();

        kept
    };

    Origin {
        api: None,
        layer: origin.layer.clone(),
        pointer,
    }
}

/// The side table key of an origin, `<layer>#<pointer>`.
pub(crate) fn lint_origin_key(origin: &Origin) -> String {
    location_key(&origin.layer, &origin.pointer)
}

/// The entries written at one origin, in the order they were met.
#[derive(Debug)]
pub(crate) struct LintOriginGroup<'ir, Entry> {
    /// The origin of the first entry.
    pub(crate) origin: &'ir Origin,
    /// Every entry written there.
    pub(crate) entries: Vec<Entry>,
}

/// Groups entries by origin key, first met first.
pub(crate) fn lint_group_by_origin<'ir, Entry>(
    entries: impl IntoIterator<Item = (&'ir Origin, Entry)>,
) -> Vec<LintOriginGroup<'ir, Entry>> {
    let mut groups: IndexMap<String, LintOriginGroup<'ir, Entry>> = IndexMap::new();

    for (origin, entry) in entries {
        groups
            .entry(lint_origin_key(origin))
            .or_insert_with(|| LintOriginGroup {
                origin,
                entries: Vec::new(),
            })
            .entries
            .push(entry);
    }

    groups.into_values().collect()
}

/// `route 'a'` for one operation, `routes 'a', 'b'` for several.
pub(crate) fn lint_routes_named(operations: &[&Operation]) -> String {
    let names: Vec<String> = operations
        .iter()
        .map(|operation| format!("'{}'", operation.id))
        .collect();
    let joined = names.join(", ");

    if operations.len() == 1 {
        format!("route {joined}")
    } else {
        format!("routes {joined}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(layer: Layer, pointer: &str) -> Origin {
        Origin {
            api: None,
            layer,
            pointer: pointer.to_owned(),
        }
    }

    #[test]
    fn the_node_is_the_pointer_without_its_last_segment() {
        let node = lint_node_of(&origin(Layer::Api, "/surfaces/app/routes/tasks/access"));

        assert_eq!(node.pointer, "/surfaces/app/routes/tasks");
        assert_eq!(node.layer, Layer::Api);
    }

    #[test]
    fn an_astral_character_before_the_slash_does_not_shift_the_cut() {
        let node = lint_node_of(&origin(Layer::Api, "/surfaces/\u{1F600}/access"));

        assert_eq!(node.pointer, "/surfaces/\u{1F600}");
    }

    #[test]
    fn a_pointer_without_a_slash_loses_its_last_character() {
        assert_eq!(lint_node_of(&origin(Layer::Api, "abc")).pointer, "ab");
        assert_eq!(lint_node_of(&origin(Layer::Api, "")).pointer, "");
    }

    #[test]
    fn a_relay_copy_and_a_core_origin_are_not_owned() {
        let relayed = Origin {
            api: Some("other".to_owned()),
            ..origin(Layer::Api, "/a")
        };

        assert!(lint_owns_origin(&origin(Layer::Api, "/a")));
        assert!(!lint_owns_origin(&origin(Layer::Core, "/errors/x")));
        assert!(!lint_owns_origin(&relayed));
    }

    #[test]
    fn groups_keep_the_first_origin_and_the_met_order() {
        let first = origin(Layer::Api, "/a");
        let second = origin(Layer::Api, "/b");
        let groups = lint_group_by_origin([(&first, 1), (&second, 2), (&first, 3)]);

        let entries: Vec<&Vec<i32>> = groups.iter().map(|group| &group.entries).collect();

        assert_eq!(entries, vec![&vec![1, 3], &vec![2]]);
    }
}
