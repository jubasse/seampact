//! The part of the relay routes that `derive.errors` reaches: the kind of a relayed operation, the
//! target a route names and the origin of a copied element.

use seampact_ir::{DeclarationKind, Layer, Origin};

/// The kind of declaration a relayed operation names.
pub const TREE_NODES_OPERATION_KIND: DeclarationKind = DeclarationKind::HttpOperation;

/// The target a relay route names: `relays: <api>.<operationId>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelayTarget {
    /// The api, the text before the first dot.
    pub api: String,
    /// The operation id, the text after the first dot.
    pub id: String,
    /// The text as written.
    pub text: String,
}

/// The target a written `relays` names: the api is the text before the first dot and is never
/// empty; `None` for a text with no dot or no api.
#[must_use]
pub fn relay_target(text: &str) -> Option<RelayTarget> {
    let (api, id) = text.split_once('.')?;

    if api.is_empty() {
        return None;
    }

    Some(RelayTarget {
        api: api.to_owned(),
        id: id.to_owned(),
        text: text.to_owned(),
    })
}

/// The origin an element copied from another api carries.
///
/// It carries that api; an element that api copied in turn keeps its own, and a core
/// declaration, which no api holds, has none.
#[must_use]
pub fn tree_nodes_relay_origin(origin: &Origin, api: &str) -> Origin {
    if origin.layer == Layer::Core || origin.api.is_some() {
        return origin.clone();
    }

    Origin {
        api: Some(api.to_owned()),
        ..origin.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(text: &str) -> Option<(String, String)> {
        relay_target(text).map(|found| (found.api, found.id))
    }

    #[test]
    fn a_relay_target_splits_at_the_first_dot_and_needs_an_api() {
        assert_eq!(
            target("public.listUsers"),
            Some(("public".to_owned(), "listUsers".to_owned()))
        );
        assert_eq!(
            target("public.a.b"),
            Some(("public".to_owned(), "a.b".to_owned()))
        );
        assert_eq!(
            target("public."),
            Some(("public".to_owned(), String::new()))
        );
        assert_eq!(target(".listUsers"), None);
        assert_eq!(target("nodot"), None);
        assert_eq!(
            relay_target("public.listUsers").map(|found| found.text),
            Some("public.listUsers".to_owned())
        );
    }
}
