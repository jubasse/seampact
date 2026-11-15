//! The templates of formats and paging styles: the slots each place allows, read by the shared template reader.

use seampact_ir::Template;
use seampact_json::JsonValue;
use seampact_pipeline::PassError;
use seampact_templates::{TemplateSlot, TemplateSlotKind};

use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// Where a template is written, which sets the slots it may use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TreeNodesTemplatePlace {
    Item,
    Table,
    List,
    Page,
    Error,
    PagingBody,
    PagingMember,
}

/// The response roles of a paging style, each a slot of its templates.
pub(crate) const TREE_NODES_RESPONSE_ROLES: &[&str] = &[
    "items",
    "nextCursor",
    "previousCursor",
    "more",
    "page",
    "offset",
    "limit",
    "from",
    "to",
    "total",
    "totalPages",
    "self",
    "first",
    "previous",
    "next",
    "last",
    "nextSince",
    "complete",
];

const EVERYWHERE: &[&str] = &["status", "self", "path"];
const SUCCESS: &[&str] = &["status", "self", "path", "payload", "meta", "resource"];
const PAGING: &[&str] = &[
    "status",
    "self",
    "path",
    "resource",
    "collection",
    "items",
    "nextCursor",
    "previousCursor",
    "more",
    "page",
    "offset",
    "limit",
    "from",
    "to",
    "total",
    "totalPages",
    "self",
    "first",
    "previous",
    "next",
    "last",
    "nextSince",
    "complete",
];

/// The slots each place allows.
const SLOTS_BY_PLACE: &[(TreeNodesTemplatePlace, &[&str])] = &[
    (
        TreeNodesTemplatePlace::Item,
        &[
            "status",
            "self",
            "path",
            "payload",
            "meta",
            "resource",
            "id",
            "fields",
            "collection",
        ],
    ),
    (
        TreeNodesTemplatePlace::Table,
        &[
            "status",
            "self",
            "path",
            "payload",
            "meta",
            "resource",
            "collection",
        ],
    ),
    (
        TreeNodesTemplatePlace::List,
        &[
            "status",
            "self",
            "path",
            "payload",
            "meta",
            "resource",
            "collection",
        ],
    ),
    (
        TreeNodesTemplatePlace::Page,
        &[
            "status", "self", "path", "payload", "meta", "resource", "items",
        ],
    ),
    (
        TreeNodesTemplatePlace::Error,
        &[
            "status", "self", "path", "code", "nature", "title", "detail", "instance", "traceId",
            "params",
        ],
    ),
    (TreeNodesTemplatePlace::PagingBody, PAGING_BODY_SLOTS),
    (TreeNodesTemplatePlace::PagingMember, PAGING),
];

/// A style's whole page body may write `$meta`, the format's meta fields; its meta members may not.
const PAGING_BODY_SLOTS: &[&str] = &[
    "status",
    "self",
    "path",
    "resource",
    "collection",
    "items",
    "nextCursor",
    "previousCursor",
    "more",
    "page",
    "offset",
    "limit",
    "from",
    "to",
    "total",
    "totalPages",
    "self",
    "first",
    "previous",
    "next",
    "last",
    "nextSince",
    "complete",
    "meta",
];

/// The slots an `each` template adds for its element.
const EACH_SLOTS: &[&str] = &["item", "itemId", "itemFields", "itemSelf"];

/// The kind of each slot that is not a plain value.
const SLOT_KINDS: &[(&str, TemplateSlotKind)] = &[
    ("collection", TemplateSlotKind::Name),
    ("payload", TemplateSlotKind::Payload),
    ("item", TemplateSlotKind::Payload),
    ("meta", TemplateSlotKind::Object),
    ("params", TemplateSlotKind::Object),
    ("fields", TemplateSlotKind::Object),
    ("itemFields", TemplateSlotKind::Object),
    ("items", TemplateSlotKind::Array),
    ("more", TemplateSlotKind::Flag),
    ("complete", TemplateSlotKind::Flag),
];

/// How a message names the place.
const PLACE_NAMES: &[(TreeNodesTemplatePlace, &str)] = &[
    (TreeNodesTemplatePlace::Item, "success.item"),
    (TreeNodesTemplatePlace::Table, "success.table"),
    (TreeNodesTemplatePlace::List, "success.list"),
    (TreeNodesTemplatePlace::Page, "success.page"),
    (TreeNodesTemplatePlace::Error, "an error body"),
    (TreeNodesTemplatePlace::PagingBody, "a paging style's body"),
    (
        TreeNodesTemplatePlace::PagingMember,
        "a paging style's meta, headers and links",
    ),
];

/// Where a template is read and who it belongs to, for its diagnostics.
#[derive(Debug, Clone)]
pub(crate) struct TreeNodesTemplateSite {
    pub(crate) place: TreeNodesTemplatePlace,
    /// The owner, as messages name it: `the format acmeEnvelope`, `the paging style cursor`.
    pub(crate) owner: String,
}

fn slots_of(names: &[&str]) -> Vec<TemplateSlot> {
    names
        .iter()
        .map(|name| TemplateSlot {
            name: (*name).to_owned(),
            kind: SLOT_KINDS
                .iter()
                .find(|(slot, _)| slot == name)
                .map_or(TemplateSlotKind::Value, |(_, kind)| *kind),
        })
        .collect()
}

pub(crate) fn tree_nodes_template(
    _site: &TreeNodesTemplateSite,
    _value: &JsonValue,
    _pointer: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Template>, PassError> {
    Err(not_ported_yet("treeNodesTemplate"))
}
