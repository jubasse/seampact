//! The embedded authoring schema files as nodes: references, file roots and compiled patterns.

use std::collections::HashMap;

use regress::Regex;
use seampact_authoring::AUTHORING_SCHEMA_FILES;
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;

use super::schema_node::{COMMON_FILE, SchemaNode};

/// The flags every pattern of a schema is compiled with: JSON Schema patterns are ECMAScript
/// regular expressions read in Unicode mode, as `new RegExp(pattern, "u")` reads them.
const PATTERN_FLAGS: &str = "u";

/// The reference to the node an include brings: it lists the keys of every node kind with no
/// constraint, for an editor, and is read through its kind instead.
const INCLUDED_NODE_REFERENCE: &str = "node.schema.json#/$defs/includedNode";

/// The file kind `INCLUDED_NODE_REFERENCE` is written in, and the kind it stands for.
const INCLUDED_NODE_FILE: &str = "node";

/// The authoring schema files, parsed once, with what the reading needs from them.
pub(super) struct SchemaFiles {
    /// The root node of each file, by file kind.
    documents: HashMap<&'static str, SchemaNode>,
    /// The file kind of each file name (`FILE_OF`).
    file_kinds: HashMap<&'static str, &'static str>,
    included_node: Option<SchemaNode>,
    /// The nodes that stand for a whole authoring file, with that file's kind.
    file_roots: HashMap<SchemaNode, &'static str>,
    /// The patterns of `patternProperties`, compiled once, by pattern text.
    patterns: HashMap<String, Regex>,
}

impl SchemaFiles {
    /// Parses the embedded schema files and compiles their patterns.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when an embedded file is not a JSON object or holds a pattern that
    /// does not compile: the bundle is broken.
    pub(super) fn load() -> Result<Self, InternalError> {
        let mut documents = HashMap::new();
        let mut file_kinds = HashMap::new();

        for file in AUTHORING_SCHEMA_FILES {
            let parsed: JsonValue = serde_json::from_str(file.text).map_err(|error| {
                InternalError::new(format!(
                    "the embedded schema {} is not JSON: {error}",
                    file.file_name
                ))
            })?;
            let JsonValue::Object(object) = &parsed else {
                return Err(InternalError::new(format!(
                    "the embedded schema {} is not an object",
                    file.file_name
                )));
            };

            documents.insert(file.kind, SchemaNode::from_object(file.kind, object));
            file_kinds.insert(file.file_name, file.kind);
        }

        let mut files = Self {
            documents,
            file_kinds,
            included_node: None,
            file_roots: HashMap::new(),
            patterns: HashMap::new(),
        };

        files.included_node = files.resolve_reference(INCLUDED_NODE_REFERENCE, INCLUDED_NODE_FILE);
        files.file_roots = files.file_roots_of();

        for root in files.documents.values().cloned().collect::<Vec<_>>() {
            files.compile_patterns(&root)?;
        }

        Ok(files)
    }

    /// The root node of the file of kind `kind` (`schemaFiles()[kind]`).
    pub(super) fn document(&self, kind: &str) -> Option<&SchemaNode> {
        self.documents.get(kind)
    }

    /// The node a `$ref` written in file `from` names, `None` when it names no node
    /// (`resolveRef`): an unknown file, a missing member, or a target that is no schema.
    pub(super) fn resolve_reference(&self, reference: &str, from: &str) -> Option<SchemaNode> {
        let mut parts = reference.split('#');
        let target = parts.next().unwrap_or("");
        let fragment = parts.next().unwrap_or("");
        let file = if target.is_empty() {
            from
        } else {
            self.file_kinds.get(target)?
        };
        let mut node = self.documents.get(file)?.clone();

        if fragment.is_empty() {
            return Some(node);
        }

        for segment in fragment.split('/').skip(1) {
            let key = segment.replace("~1", "/").replace("~0", "~");

            node = node.node_member(&key)?.clone();
        }

        Some(node)
    }

    /// The node the `$ref` of `node` names (`referenced`).
    pub(super) fn referenced(&self, node: &SchemaNode) -> Option<SchemaNode> {
        let reference = node.string_member("$ref")?;

        self.resolve_reference(reference, node.file())
    }

    /// Whether `node` is the node an include brings (`isIncludedNode`).
    pub(super) fn is_included_node(&self, node: &SchemaNode) -> bool {
        self.included_node.as_ref() == Some(node)
    }

    /// The nodes that stand for a whole authoring file: its root, and the definition its root
    /// references (`node.schema.json` is the `surfaceChild` definition; a tree node an include
    /// brings is read through `includedNode`).
    fn file_roots_of(&self) -> HashMap<SchemaNode, &'static str> {
        let mut roots = HashMap::new();

        for file in AUTHORING_SCHEMA_FILES {
            if file.kind == COMMON_FILE {
                continue;
            }

            let Some(root) = self.documents.get(file.kind) else {
                continue;
            };

            roots.insert(root.clone(), file.kind);

            if let Some(target) = self.referenced(root) {
                roots.insert(target, file.kind);
            }
        }

        if let Some(included) = &self.included_node {
            roots.insert(included.clone(), INCLUDED_NODE_FILE);
        }

        roots
    }

    /// The file kind `node` stands for the whole of, when it is the root of a file.
    pub(super) fn file_root_kind(&self, node: &SchemaNode) -> Option<&'static str> {
        self.file_roots.get(node).copied()
    }

    /// Compiles the `patternProperties` patterns of `root` and of every schema below it.
    ///
    /// A pattern is read from the keyword only: a property that happens to be called
    /// `patternProperties` is not one.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a pattern that does not compile: the schema is broken.
    pub(super) fn compile_patterns(&mut self, root: &SchemaNode) -> Result<(), InternalError> {
        let mut nodes = Vec::new();

        root.visit_schemas(&mut |node| nodes.push(node.clone()));

        for node in nodes {
            let Some(patterns) = node.node_member("patternProperties") else {
                continue;
            };

            for (pattern, _) in patterns.members() {
                self.compile_pattern(pattern)?;
            }
        }

        Ok(())
    }

    fn compile_pattern(&mut self, pattern: &str) -> Result<(), InternalError> {
        if self.patterns.contains_key(pattern) {
            return Ok(());
        }

        let compiled = Regex::with_flags(pattern, PATTERN_FLAGS).map_err(|error| {
            InternalError::new(format!(
                "the schema pattern {pattern:?} does not compile as an ECMAScript pattern: {error}"
            ))
        })?;

        self.patterns.insert(pattern.to_owned(), compiled);

        Ok(())
    }

    /// Whether `pattern`, a `patternProperties` key, matches somewhere in `text`
    /// (`patternOf(pattern).test(text)`).
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a pattern no schema walked at load carries.
    pub(super) fn matches_pattern(&self, pattern: &str, text: &str) -> Result<bool, InternalError> {
        let compiled = self.patterns.get(pattern).ok_or_else(|| {
            InternalError::new(format!(
                "the schema pattern {pattern:?} was not compiled when the schemas were loaded"
            ))
        })?;

        Ok(compiled.find(text).is_some())
    }
}
