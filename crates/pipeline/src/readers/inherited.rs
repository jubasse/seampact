//! The inherited settings of ADR 0002 section 8 and the merge shape of each (ADR 0006 section 2).
//!
//! `Inherited` applies the merge and returns each value with the origin of the node that set it;
//! it reports nothing: the conflict diagnostics and the filters (`query` on safe routes, `errors`
//! within `reach` and `for`, pack-derived requirements first) belong to the half that owns the
//! setting. `errors` is the one union `Inherited` does not reduce: an equal attachment on a nested
//! node is kept, because `reach` and `for` apply per attachment (ADR 0002 section 11), so
//! derive.errors filters each attachment first and then unions by code. A setting ADR 0002
//! section 8 does not inherit (`owner`, `concurrency`, `paging`, `examples`, ...) has no setting
//! name here, so asking for it does not compile.

use std::collections::HashSet;

use indexmap::IndexMap;
use seampact_authoring::RawApi;
use seampact_diagnostics::InternalError;
use seampact_ir::Origin;
use seampact_json::{JsonValue, canonical_json};

use super::pointer::{json_at_object, pipeline_origin, pointer_below};
use super::tree::{TreeNodeId, TreeNodes, pipeline_tree_nodes};

/// The prefix of an extension setting (`x-owner-team`).
const EXTENSION_PREFIX: &str = "x-";

/// A setting where the nearest node that sets it wins.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NearestSetting {
    /// `identity`.
    Identity,
    /// `access`.
    Access,
    /// `upstream`.
    Upstream,
    /// `maturity`.
    Maturity,
    /// `internal`.
    Internal,
    /// `deprecated`.
    Deprecated,
    /// `budget`.
    Budget,
    /// `bodyLimit`.
    BodyLimit,
    /// `cache`.
    Cache,
    /// `csrf`.
    Csrf,
    /// `idempotency`.
    Idempotency,
    /// `format`.
    Format,
    /// `unknownQuery`.
    UnknownQuery,
    /// An `x-` extension key, written whole.
    Extension(String),
}

impl NearestSetting {
    /// The extension setting named `key`; `None` when `key` does not start with `x-`.
    #[must_use]
    pub fn extension(key: &str) -> Option<Self> {
        key.starts_with(EXTENSION_PREFIX)
            .then(|| Self::Extension(key.to_owned()))
    }

    fn name(&self) -> &str {
        match self {
            Self::Identity => "identity",
            Self::Access => "access",
            Self::Upstream => "upstream",
            Self::Maturity => "maturity",
            Self::Internal => "internal",
            Self::Deprecated => "deprecated",
            Self::Budget => "budget",
            Self::BodyLimit => "bodyLimit",
            Self::Cache => "cache",
            Self::Csrf => "csrf",
            Self::Idempotency => "idempotency",
            Self::Format => "format",
            Self::UnknownQuery => "unknownQuery",
            Self::Extension(key) => key,
        }
    }

    // An extension key is one member name, dots included.
    fn path(&self) -> Vec<&str> {
        match self {
            Self::Extension(key) => vec![key],
            other => other.name().split('.').collect(),
        }
    }
}

/// A setting where, per key, the nearest node that sets it wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PerKeySetting {
    /// `errorRoles`.
    ErrorRoles,
}

impl PerKeySetting {
    const fn name(self) -> &'static str {
        match self {
            Self::ErrorRoles => "errorRoles",
        }
    }
}

/// A setting whose every entry is kept, ordered from the root down to the node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderedSetting {
    /// `requires`.
    Requires,
    /// `scopes`.
    Scopes,
    /// `bindings`.
    Bindings,
    /// `headers`.
    Headers,
    /// `query`.
    Query,
    /// `lint.allow`.
    LintAllow,
}

impl OrderedSetting {
    const fn name(self) -> &'static str {
        match self {
            Self::Requires => "requires",
            Self::Scopes => "scopes",
            Self::Bindings => "bindings",
            Self::Headers => "headers",
            Self::Query => "query",
            Self::LintAllow => "lint.allow",
        }
    }
}

/// A setting that is the union of the entries of every node, from the root down to the node.
///
/// For `errors`, every attachment is kept (derive.errors unions by code after its `reach` and
/// `for` filter).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnionSetting {
    /// `principal.requires`.
    PrincipalRequires,
    /// `errors`.
    Errors,
    /// `tags`.
    Tags,
}

impl UnionSetting {
    const fn name(self) -> &'static str {
        match self {
            Self::PrincipalRequires => "principal.requires",
            Self::Errors => "errors",
            Self::Tags => "tags",
        }
    }
}

/// A value with the origin of the node that set it.
#[derive(Debug, Clone, PartialEq)]
pub struct InheritedEntry<'run> {
    /// The raw value: a whole setting, one list item, or one map entry's value.
    pub value: &'run JsonValue,
    /// The map key of an entry of a map-valued setting (`scopes`, `bindings`, `headers`,
    /// `errors`, ...).
    pub key: Option<String>,
    /// The origin of the entry.
    pub origin: Origin,
    /// The node that set the entry.
    pub node: TreeNodeId,
}

// How an entry sits in its setting's value.
#[derive(Clone, Copy)]
enum EntryPlace<'value> {
    Whole,
    Key(&'value str),
    Index(usize),
}

/// The inherited-setting reader of one api (ADR 0002 section 8): it merges a setting from the
/// root down to a node by its shape and returns each value with the origin of the node that set it.
///
/// It reports nothing and filters nothing (section 2 of ADR 0006: the owning half does), and
/// `errorRoles` does not fall back to `conventions.errors.derived` (read that through
/// `ResolvedConventions`).
#[derive(Debug, Clone)]
pub struct Inherited<'run> {
    raw: &'run RawApi,
    nodes: TreeNodes<'run>,
}

impl<'run> Inherited<'run> {
    /// The reader of `raw`, with its tree nodes built.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the tree-node model of `raw` is inconsistent.
    pub fn new(raw: &'run RawApi) -> Result<Self, InternalError> {
        Ok(Self {
            raw,
            nodes: pipeline_tree_nodes(raw)?,
        })
    }

    /// The tree nodes of the api.
    #[must_use]
    pub const fn nodes(&self) -> &TreeNodes<'run> {
        &self.nodes
    }

    // The nodes from the root down to `node` that set `path`, with the value each wrote.
    fn written(
        &self,
        node: TreeNodeId,
        path: &[&str],
    ) -> Result<Vec<(TreeNodeId, &'run JsonValue)>, InternalError> {
        let chain = self.nodes.chain(node)?;

        Ok(chain
            .into_iter()
            .filter_map(|(id, at)| json_at_object(at.settings, path).map(|value| (id, value)))
            .collect())
    }

    fn entry_of(
        &self,
        node: TreeNodeId,
        path: &[&str],
        value: &'run JsonValue,
        place: EntryPlace<'_>,
    ) -> Result<InheritedEntry<'run>, InternalError> {
        let at = self.nodes.get(node)?;
        let mut segments = path.to_vec();
        let index_text;

        match place {
            EntryPlace::Whole => {}
            EntryPlace::Key(key) => segments.push(key),
            EntryPlace::Index(index) => {
                index_text = index.to_string();
                segments.push(&index_text);
            }
        }

        let pointer = pointer_below(&at.pointer, &segments);
        let origin = pipeline_origin(self.raw, &pointer).unwrap_or_else(|| at.origin.clone());
        let key = match place {
            EntryPlace::Key(key) => Some(key.to_owned()),
            EntryPlace::Whole | EntryPlace::Index(_) => None,
        };

        Ok(InheritedEntry {
            value,
            key,
            origin,
            node,
        })
    }

    /// The nearest node that sets `setting`, from the root down to `node`; `None` when none does.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a node of another api.
    pub fn nearest(
        &self,
        node: TreeNodeId,
        setting: &NearestSetting,
    ) -> Result<Option<InheritedEntry<'run>>, InternalError> {
        let path = setting.path();
        let written = self.written(node, &path)?;

        written
            .last()
            .map(|(at, value)| self.entry_of(*at, &path, value, EntryPlace::Whole))
            .transpose()
    }

    /// Each key of `setting` with the entry of the nearest node that set it, in first-set order;
    /// `None` when no node sets the setting.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a node of another api.
    pub fn per_key(
        &self,
        node: TreeNodeId,
        setting: PerKeySetting,
    ) -> Result<Option<IndexMap<String, InheritedEntry<'run>>>, InternalError> {
        let path: Vec<&str> = setting.name().split('.').collect();
        let written = self.written(node, &path)?;

        if written.is_empty() {
            return Ok(None);
        }

        let mut entries = IndexMap::new();

        for (at, value) in written {
            let JsonValue::Object(object) = value else {
                continue;
            };

            for (key, item) in object {
                let entry = self.entry_of(at, &path, item, EntryPlace::Key(key))?;

                entries.insert(key.clone(), entry);
            }
        }

        Ok(Some(entries))
    }

    fn list_entries(
        &self,
        node: TreeNodeId,
        name: &str,
    ) -> Result<Option<Vec<InheritedEntry<'run>>>, InternalError> {
        let path: Vec<&str> = name.split('.').collect();
        let written = self.written(node, &path)?;

        if written.is_empty() {
            return Ok(None);
        }

        let mut entries = Vec::new();

        for (at, value) in written {
            match value {
                JsonValue::Array(items) => {
                    for (index, item) in items.iter().enumerate() {
                        entries.push(self.entry_of(at, &path, item, EntryPlace::Index(index))?);
                    }
                }
                JsonValue::Object(object) => {
                    for (key, item) in object {
                        entries.push(self.entry_of(at, &path, item, EntryPlace::Key(key))?);
                    }
                }
                _ => entries.push(self.entry_of(at, &path, value, EntryPlace::Whole)?),
            }
        }

        Ok(Some(entries))
    }

    /// Every entry of `setting` from the root down to `node`, in written order within a node: a
    /// list's items, a map's entries (with `key`), or a whole value of another form; `None` when
    /// no node sets it.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a node of another api.
    pub fn ordered(
        &self,
        node: TreeNodeId,
        setting: OrderedSetting,
    ) -> Result<Option<Vec<InheritedEntry<'run>>>, InternalError> {
        self.list_entries(node, setting.name())
    }

    /// The union of the entries of `setting` over every node from the root down to `node`: an
    /// entry equal to an earlier one (same key, and the same value whatever its key order) is
    /// dropped, so the first setter's origin stays. For `errors`, every attachment is kept with
    /// its node and origin, equal ones included: an equal attachment on a nested node with
    /// `reach: resource` reaches where the root's does not, so the owning half filters each one
    /// before the union.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a node of another api.
    pub fn union(
        &self,
        node: TreeNodeId,
        setting: UnionSetting,
    ) -> Result<Option<Vec<InheritedEntry<'run>>>, InternalError> {
        let Some(entries) = self.list_entries(node, setting.name())? else {
            return Ok(None);
        };

        if setting == UnionSetting::Errors {
            return Ok(Some(entries));
        }

        let mut seen = HashSet::new();
        let union = entries
            .into_iter()
            .filter(|entry| seen.insert(entry_identity(entry)))
            .collect();

        Ok(Some(union))
    }
}

// The identity of a union entry: its key and its value in canonical form, so key order is ignored.
fn entry_identity(entry: &InheritedEntry<'_>) -> String {
    let key = entry
        .key
        .as_ref()
        .map_or(JsonValue::Null, |key| JsonValue::String(key.clone()));

    canonical_json(&JsonValue::Array(vec![key, entry.value.clone()]))
}
