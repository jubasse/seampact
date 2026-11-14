//! The part of the relay routes that `derive.errors` reaches: the kind of a relayed operation and
//! the origin of a copied element.

use seampact_ir::{DeclarationKind, Layer, Origin};

/// The kind of declaration a relayed operation names.
pub const TREE_NODES_OPERATION_KIND: DeclarationKind = DeclarationKind::HttpOperation;

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
