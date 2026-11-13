//! Where the authoring schemas expect which type, and where they expect any value.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use indexmap::IndexSet;
use seampact_authoring::{DATA, LayerSchemaKind};
use seampact_diagnostics::InternalError;
use seampact_js::cmp_utf16;
use seampact_json::JsonValue;

use super::condition::MapView;
use super::leaves::{Refinement, leaves};
use super::scalar_type::ScalarType;
use super::schema_files::SchemaFiles;
use super::schema_node::{COMMON_FILE, SchemaNode, SchemaValue};
use super::step::{Step, StepKind, step_node};
use super::types::{TypeName, TypeSet, types_of};

/// The slot of the position of every list index.
const ITEM_SLOT: &str = "\0item";

/// The slot shared by every key no schema mentions: a catalogue of many names costs one lookup.
const OTHER_SLOT: &str = "\0other";

/// The keywords a position is searched through for the file it stands for.
const KIND_COMBINATORS: [&str; 5] = ["allOf", "anyOf", "oneOf", "then", "else"];

/// One position of the schemas: a schema node reached from a file's root, one key or index at a
/// time. Equal when it is the same position, whatever its content.
#[derive(Debug, Clone)]
pub struct Position(Arc<PositionNode>);

#[derive(Debug)]
struct PositionNode {
    id: u64,
    /// A data position, marked `DATA` by the grammar: anything below is data.
    data: bool,
    /// What the position accepts, `None` when it cannot say.
    types: Option<TypeSet>,
    /// The schema node of the position; several nodes are joined as an `allOf` or an `anyOf`.
    node: SchemaNode,
    /// Every node reached through references and combinators; filled when first asked.
    leaf_set: OnceLock<Vec<SchemaNode>>,
    /// The `if` nodes the mapping's keys decided, with the branch taken (a refined position).
    choices: Option<HashMap<SchemaNode, bool>>,
}

impl Position {
    /// Whether the position is a data position, where anything below is data.
    #[must_use]
    pub fn is_data(&self) -> bool {
        self.0.data
    }

    /// What the position accepts, `None` when it cannot say.
    #[must_use]
    pub fn types(&self) -> Option<&TypeSet> {
        self.0.types.as_ref()
    }
}

impl PartialEq for Position {
    fn eq(&self, other: &Self) -> bool {
        self.0.id == other.0.id
    }
}

impl Eq for Position {}

/// The interpreter of the authoring schemas: the schema files, and every position learnt so far.
///
/// What is learnt below a position is kept, and positions refined for the same choices are one
/// position. Build one per load.
pub struct Positions {
    files: SchemaFiles,
    next_id: u64,
    roots: HashMap<LayerSchemaKind, Position>,
    entry_root: Option<Position>,
    /// The position of a key or an index below a position, by position and slot.
    children: HashMap<(u64, String), Option<Position>>,
    /// The positions refined for one set of branch choices, by position and choices.
    refined: HashMap<(u64, Vec<Option<bool>>), Position>,
}

impl Positions {
    /// Reads the embedded authoring schemas.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the embedded schemas are broken: a file that is no JSON object
    /// or a pattern that does not compile.
    pub fn new() -> Result<Self, InternalError> {
        Ok(Self {
            files: SchemaFiles::load()?,
            next_id: 0,
            roots: HashMap::new(),
            entry_root: None,
            children: HashMap::new(),
            refined: HashMap::new(),
        })
    }

    fn new_position(&mut self, node: SchemaNode) -> Position {
        let data = is_data(&node);
        let types = if data {
            None
        } else {
            types_of(&self.files, &node)
        };

        self.build_position(data, types, node, OnceLock::new(), None)
    }

    fn build_position(
        &mut self,
        data: bool,
        types: Option<TypeSet>,
        node: SchemaNode,
        leaf_set: OnceLock<Vec<SchemaNode>>,
        choices: Option<HashMap<SchemaNode, bool>>,
    ) -> Position {
        let id = self.next_id;

        self.next_id += 1;

        Position(Arc::new(PositionNode {
            id,
            data,
            types,
            node,
            leaf_set,
            choices,
        }))
    }

    /// The position a step leads to: `None` when it constrains nothing or allows no child
    /// (`position`).
    fn position(&mut self, step: Step) -> Option<Position> {
        match step {
            Step::Node(node) => Some(self.new_position(node)),
            Step::Free | Step::NoChild => None,
        }
    }

    /// The position of one schema, read as the root of a document; `None` when `schema` is no
    /// object (`positionOf`).
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a `patternProperties` pattern that does not compile.
    pub fn position_of(&mut self, schema: &JsonValue) -> Result<Option<Position>, InternalError> {
        let JsonValue::Object(object) = schema else {
            return Ok(None);
        };
        let node = SchemaNode::from_object(COMMON_FILE, object);

        self.files.compile_patterns(&node)?;

        Ok(Some(self.new_position(node)))
    }

    /// The position of a file's root, one per kind: what is learnt below it is kept
    /// (`rootPosition`).
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the embedded schemas lack the file of the kind.
    pub fn root_position(&mut self, kind: LayerSchemaKind) -> Result<Position, InternalError> {
        if let Some(root) = self.roots.get(&kind) {
            return Ok(root.clone());
        }

        let file = schema_file_kind(kind);
        let node = self
            .files
            .document(file)
            .ok_or_else(|| InternalError::new(format!("no embedded schema of kind {file}")))?
            .clone();
        let root = self.new_position(node);

        self.roots.insert(kind, root.clone());

        Ok(root)
    }

    /// The root of an entry file whose kind its own keys do not tell (its `$include` brings
    /// them): the workspace and the api root schemas as alternatives, so each key is typed by the
    /// kind it belongs to (`entryRootPosition`).
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when the embedded schemas lack the workspace or the api file.
    pub fn entry_root_position(&mut self) -> Result<Position, InternalError> {
        if let Some(root) = &self.entry_root {
            return Ok(root.clone());
        }

        let workspace = self.root_position(LayerSchemaKind::Workspace)?;
        let api = self.root_position(LayerSchemaKind::Api)?;
        let alternatives = SchemaValue::Array(vec![
            SchemaValue::Object(workspace.0.node.clone()),
            SchemaValue::Object(api.0.node.clone()),
        ]);
        let root = self.new_position(SchemaNode::with_member("anyOf", alternatives));

        self.entry_root = Some(root.clone());

        Ok(root)
    }

    /// The nodes a position stands for once references and combinators are opened (`leafSetOf`).
    fn leaf_set_of<'position>(&self, position: &'position Position) -> &'position [SchemaNode] {
        position.0.leaf_set.get_or_init(|| {
            let mut out = IndexSet::new();

            leaves(&self.files, &position.0.node, &mut out, None);

            out.into_iter().collect()
        })
    }

    /// The position for a mapping whose keys are known: conditional branches its keys decide are
    /// chosen (a node with `method` is a route, so the keys of a collection are not looked up in
    /// it). Positions refined for the same choices are one position (`refinePosition`).
    pub fn refine_position(
        &mut self,
        position: Option<&Position>,
        view: &dyn MapView,
    ) -> Option<Position> {
        let position = position?;

        if position.is_data() {
            return Some(position.clone());
        }

        let mut refinement = Refinement::new(view);
        let mut out = IndexSet::new();

        leaves(
            &self.files,
            &position.0.node,
            &mut out,
            Some(&mut refinement),
        );

        let Refinement { trace, choices, .. } = refinement;
        let signature = (position.0.id, trace);

        if let Some(hit) = self.refined.get(&signature) {
            return Some(hit.clone());
        }

        let refined = self.build_position(
            position.0.data,
            position.0.types.clone(),
            position.0.node.clone(),
            OnceLock::from(out.into_iter().collect::<Vec<_>>()),
            Some(choices),
        );

        self.refined.insert(signature, refined.clone());

        Some(refined)
    }

    /// Whether some node of `from` names `segment` as a property, or holds patterns (`mentions`).
    fn mentions(&self, from: &Position, segment: &str) -> bool {
        self.leaf_set_of(from).iter().any(|leaf| {
            let names_segment = leaf
                .node_member("properties")
                .is_some_and(|properties| properties.member(segment).is_some());

            names_segment || leaf.node_member("patternProperties").is_some()
        })
    }

    /// The position of a key or a list index of `from`; `None` when the schemas say nothing
    /// about it (`stepPosition`).
    ///
    /// Memoised: a name no schema mentions shares one entry, so a catalogue of many names costs
    /// one lookup.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a `patternProperties` pattern the load did not compile.
    pub fn step_position(
        &mut self,
        from: Option<&Position>,
        segment: &str,
        kind: StepKind,
    ) -> Result<Option<Position>, InternalError> {
        let Some(from) = from else {
            return Ok(None);
        };
        let slot = match kind {
            StepKind::Index => ITEM_SLOT,
            StepKind::Key if self.mentions(from, segment) => segment,
            StepKind::Key => OTHER_SLOT,
        };
        let memo_key = (from.0.id, slot.to_owned());

        if let Some(known) = self.children.get(&memo_key) {
            return Ok(known.clone());
        }

        let step = step_node(
            &self.files,
            &from.0.node,
            segment,
            kind,
            from.0.choices.as_ref(),
        )?;
        let next = self.position(step);

        self.children.insert(memo_key, next.clone());

        Ok(next)
    }

    /// The position of a pointer given as unescaped segments (a list index is a decimal
    /// segment), read from the root of a file kind (`positionAt`).
    ///
    /// # Errors
    ///
    /// As [`Positions::root_position`] and [`Positions::step_position`].
    pub fn position_at(
        &mut self,
        kind: LayerSchemaKind,
        segments: &[impl AsRef<str>],
    ) -> Result<Option<Position>, InternalError> {
        let mut position = Some(self.root_position(kind)?);

        for segment in segments {
            position = self.step_position(position.as_ref(), segment.as_ref(), StepKind::Key)?;
        }

        Ok(position)
    }

    /// The authoring file a mapping at `position` is, read from the schemas: the one file whose
    /// root the position reaches through `$ref` and combinators (a fragment's kind is the one its
    /// include site expects). `None` when it reaches none, or several (an entry file read as a
    /// workspace or an api) (`positionFragmentKind`).
    #[must_use]
    pub fn position_fragment_kind(&self, position: Option<&Position>) -> Option<&'static str> {
        let position = position.filter(|position| !position.is_data())?;
        let mut kinds: IndexSet<&'static str> = IndexSet::new();
        let mut visited = HashSet::new();
        let mut pending = vec![position.0.node.clone()];

        while let Some(node) = pending.pop() {
            if !visited.insert(node.clone()) {
                continue;
            }

            if let Some(kind) = self.files.file_root_kind(&node) {
                kinds.insert(kind);

                continue;
            }

            pending.extend(self.files.referenced(&node));

            for key in KIND_COMBINATORS {
                pending.extend(node.subschemas(key));
            }
        }

        let mut kinds = kinds.into_iter();

        match (kinds.next(), kinds.next()) {
            (Some(only), None) => Some(only),
            _ => None,
        }
    }

    /// The keys a mapping at this position may hold (its `properties`, `$include` apart), sorted;
    /// empty when it names none (`expectedKeys`).
    #[must_use]
    pub fn expected_keys(&self, position: &Position) -> Vec<String> {
        let mut keys: IndexSet<&str> = IndexSet::new();

        for node in self.leaf_set_of(position) {
            let Some(properties) = node.node_member("properties") else {
                continue;
            };

            keys.extend(
                properties
                    .members()
                    .map(|(key, _)| key.as_str())
                    .filter(|key| !key.starts_with('$')),
            );
        }

        let mut sorted: Vec<String> = keys.into_iter().map(str::to_owned).collect();

        sorted.sort_by(|left, right| cmp_utf16(left, right));

        sorted
    }

    /// Whether the position's integer form takes `n`: some node of the position that types an
    /// integer bounds it with `minimum`, `maximum` or their exclusive forms, and `n` is within
    /// all the bounds of one of them (no such node: any integer) (`admitsInteger`).
    #[must_use]
    pub fn admits_integer(&self, position: &Position, n: f64) -> bool {
        let mut forms = self
            .leaf_set_of(position)
            .iter()
            .filter(|node| types_integer(node))
            .peekable();

        if forms.peek().is_none() {
            return true;
        }

        forms.any(|node| within_bounds(node, n))
    }
}

/// What the position accepts, written for a message: `a string`, `an integer`; sorted by type
/// name. `None` when it cannot say (`expectedTypes`).
#[must_use]
pub fn expected_types(position: &Position) -> Option<Vec<&'static str>> {
    let types = position.types()?;

    Some(types.iter().map(|name| name.words()).collect())
}

/// True when a scalar of this type is a type the position does not accept (`refusesScalar`).
#[must_use]
pub fn refuses_scalar(position: Option<&Position>, scalar: ScalarType) -> bool {
    let Some(types) = position.and_then(Position::types) else {
        return false;
    };

    if types.is_empty() || types.contains(&scalar.type_name()) {
        return false;
    }

    // A whole number is a number; an integer position does not take a fraction.
    !(scalar == ScalarType::Integer && types.contains(&TypeName::Number))
}

/// The file kind a layer kind is read as: the name of its authoring schema file.
fn schema_file_kind(kind: LayerSchemaKind) -> &'static str {
    match kind {
        LayerSchemaKind::Workspace => "workspace",
        LayerSchemaKind::Api => "api",
        LayerSchemaKind::Base => "base",
        LayerSchemaKind::Pack => "pack",
    }
}

/// A data position is one the grammar marks; joined nodes are data when a constraint that holds
/// marks it, or when every alternative does (`isData`).
fn is_data(node: &SchemaNode) -> bool {
    if node.string_member("title") == Some(DATA) {
        return true;
    }

    if node.list_member("allOf").is_some() {
        return node.subschemas("allOf").iter().any(is_data);
    }

    if node.list_member("anyOf").is_some() {
        return node.subschemas("anyOf").iter().all(is_data);
    }

    false
}

/// Whether the node's `type` is `integer`, or a list that holds it.
fn types_integer(node: &SchemaNode) -> bool {
    let is_integer =
        |name: &SchemaValue| matches!(name, SchemaValue::String(text) if text == "integer");

    match node.member("type") {
        Some(SchemaValue::Array(names)) => names.iter().any(is_integer),
        Some(single) => is_integer(single),
        None => false,
    }
}

/// Whether `n` is within every bound the node states.
fn within_bounds(node: &SchemaNode, n: f64) -> bool {
    let at_least = |bound: f64| n >= bound;
    let at_most = |bound: f64| n <= bound;
    let above = |bound: f64| n > bound;
    let below = |bound: f64| n < bound;

    node.number_member("minimum").is_none_or(at_least)
        && node.number_member("maximum").is_none_or(at_most)
        && node.number_member("exclusiveMinimum").is_none_or(above)
        && node.number_member("exclusiveMaximum").is_none_or(below)
}
