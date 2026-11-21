//! The `input` member of an operation: its media type and schema, the fields of a form, and the files below the top level.

use std::collections::HashSet;

use seampact_diagnostics::{DiagnosticOrigin, InternalError, RelatedLocation};
use seampact_ir::{
    Direction, FieldWire, InputField, InputMediaType, KnownSchemaRef, KnownTypeUseRef, Origin,
    Property, Schema, TypeUse,
};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{
    tree_nodes_answered_use, tree_nodes_draft_schema, tree_nodes_member, tree_nodes_schema,
};
use seampact_pipeline::{
    DraftIr, DraftOperationInput, PassError, TreeNode, TreeNodeId, pointer_below,
};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_locate,
    tree_nodes_node_origin,
};
use crate::field_wire::{tree_nodes_field_wire_of, tree_nodes_is_file_field};
use crate::limits::{TreeNodesBodyLimitContext, tree_nodes_body_limit};
use crate::pass::TreeNodesScope;

const JSON_MEDIA: InputMediaType = InputMediaType::ApplicationJson;
const REF_KEY: &str = "$ref";
const FORM_MEDIA: InputMediaType = InputMediaType::ApplicationXWwwFormUrlencoded;
const MULTIPART_MEDIA: InputMediaType = InputMediaType::MultipartFormData;
/// The media each `input` setting value stands for.
const MEDIA_OF_INPUT_MEDIA: &[(&str, InputMediaType)] = &[
    ("json", JSON_MEDIA),
    ("form", FORM_MEDIA),
    ("multipart", MULTIPART_MEDIA),
];
/// How a message names each media.
const MEDIA_WORD: &[(InputMediaType, &str)] = &[
    (JSON_MEDIA, "JSON"),
    (FORM_MEDIA, "form"),
    (MULTIPART_MEDIA, "multipart"),
];

/// Where an input is checked: the operation and the media its schema is written for.
#[derive(Debug, Clone)]
struct InputSite<'node, 'raw> {
    node_id: TreeNodeId,
    node: &'node TreeNode<'raw>,
    operation_id: &'node str,
    origin: DiagnosticOrigin,
    media: InputMediaType,
}

/// A file reached below the top level of an input.
#[derive(Debug, Clone, PartialEq)]
struct NestedFile {
    path: String,
    origin: Option<Origin>,
}

/// The input a route or an op entry declares (`input`), or `None` when it declares none.
///
/// The schema is the input use the service answers for the written schema; reads `schemas` for the fields of a
/// form or multipart body.
pub(crate) fn tree_nodes_input(
    node_id: TreeNodeId,
    node: &TreeNode<'_>,
    operation_id: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperationInput>, PassError> {
    if !node.settings.contains_key("input") {
        return Ok(None);
    }

    let pointer = format!("{}/input", node.pointer);
    let Some(origin) = scope.context.origin(&pointer) else {
        return Err(InternalError::new(format!(
            "the raw tree has no origin for the input at {pointer}"
        ))
        .into());
    };
    let schema = tree_nodes_answered_use(scope.schemas, &pointer, &Direction::Input)?;
    let media = media_of(node)?;
    let site = InputSite {
        node_id,
        node,
        operation_id,
        origin: tree_nodes_node_origin(&origin)?,
        media: media.clone(),
    };
    let is_json = media == JSON_MEDIA;
    let input = DraftOperationInput {
        media,
        schema: schema.clone(),
        body_limit_bytes: None,
        raw_body: None,
        fields: None,
        proofs: None,
        origin,
    };

    if is_json {
        let files = files_below(&schema, None, scope)?;

        report_nested_files(&site, &files, None, scope);

        return Ok(Some(input));
    }

    let fields = form_fields(&site, &schema, scope)?;

    Ok(Some(DraftOperationInput { fields, ..input }))
}

fn media_of(node: &TreeNode<'_>) -> Result<InputMediaType, PassError> {
    let Some(written) = node.settings.get("inputMedia") else {
        return Ok(JSON_MEDIA);
    };
    let media = match written {
        JsonValue::String(text) => MEDIA_OF_INPUT_MEDIA
            .iter()
            .find(|(name, _)| name == text)
            .map(|(_, media)| media.clone()),
        _ => None,
    };

    media.ok_or_else(|| {
        InternalError::new(format!(
            "inputMedia at {} is no media the grammar admits",
            node.pointer
        ))
        .into()
    })
}

// A file reached below the top level of an input: a JSON body carries none, a form or multipart field neither.
fn report_nested_files(
    site: &InputSite<'_, '_>,
    files: &[NestedFile],
    field: Option<&str>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) {
    for file in files {
        let at = if file.path.is_empty() {
            String::new()
        } else {
            format!(" at {}", file.path)
        };
        let message = match field {
            None => format!(
                "The JSON input of {} holds a file{}, but a file travels only in a multipart input or as a download.",
                site.operation_id,
                if at.is_empty() {
                    " as its whole body"
                } else {
                    &at
                }
            ),
            Some(field) => format!(
                "The {} input of {} holds a file{at} inside the field {field}, but a file is a top-level field.",
                media_word(&site.media),
                site.operation_id
            ),
        };
        let origin = match &file.origin {
            Some(origin) => tree_nodes_locate(origin, &site.origin),
            None => site.origin.clone(),
        };

        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::InputFile,
                origin,
                message,
                fix: "Make the file a top-level field of a multipart input (inputMedia: multipart), or return it as a download."
                    .to_owned(),
                related: Vec::new(),
            }));
    }
}

/// The members from the top level down to a use below it, kept as a chain so a path is written only
/// where a file is found.
#[derive(Debug)]
struct PathSegment<'draft> {
    parent: Option<usize>,
    member: &'draft str,
}

/// One thing still to do: walk a use, or enter a schema, each at its path in `FileWalk::segments`.
enum FileStep<'draft> {
    Use {
        use_: &'draft TypeUse,
        path: Option<usize>,
        origin: Option<&'draft Origin>,
    },
    Schema {
        id: &'draft str,
        path: Option<usize>,
    },
}

/// The files one walk of `files_below` has found and the schemas it has entered.
struct FileWalk<'draft> {
    draft: &'draft DraftIr,
    found: Vec<NestedFile>,
    visited: HashSet<&'draft str>,
    segments: Vec<PathSegment<'draft>>,
}

impl<'draft> FileWalk<'draft> {
    /// Walks with an explicit stack, so a long chain of schemas cannot overflow the call stack;
    /// children are pushed in reverse to come off in the order a recursive walk meets them.
    fn walk(&mut self, first: FileStep<'draft>) -> Result<(), InternalError> {
        let mut pending = vec![first];

        while let Some(step) = pending.pop() {
            let mut children = match step {
                FileStep::Use { use_, path, origin } => self.use_steps(use_, path, origin)?,
                FileStep::Schema { id, path } => self.schema_steps(id, path)?,
            };

            children.reverse();
            pending.extend(children);
        }

        Ok(())
    }

    fn use_steps(
        &mut self,
        at: &'draft TypeUse,
        path: Option<usize>,
        origin: Option<&'draft Origin>,
    ) -> Result<Vec<FileStep<'draft>>, InternalError> {
        let steps = match KnownTypeUseRef::try_from(at)? {
            KnownTypeUseRef::File(_) => {
                self.found.push(NestedFile {
                    path: self.render(path),
                    origin: origin.cloned(),
                });

                Vec::new()
            }
            KnownTypeUseRef::Array(array) => vec![FileStep::Use {
                use_: &array.items,
                path,
                origin,
            }],
            KnownTypeUseRef::Ref(reference) => vec![FileStep::Schema {
                id: reference.schema.as_str(),
                path,
            }],
            KnownTypeUseRef::Scalar(scalar) => scalar
                .content
                .iter()
                .map(|content| FileStep::Use {
                    use_: &content.schema,
                    path,
                    origin,
                })
                .collect(),
            KnownTypeUseRef::Enum(_) | KnownTypeUseRef::Opaque(_) => Vec::new(),
        };

        Ok(steps)
    }

    fn schema_steps(
        &mut self,
        id: &'draft str,
        path: Option<usize>,
    ) -> Result<Vec<FileStep<'draft>>, InternalError> {
        if !self.visited.insert(id) {
            return Ok(Vec::new());
        }

        let steps = match KnownSchemaRef::try_from(tree_nodes_draft_schema(self.draft, id)?)? {
            KnownSchemaRef::Object(object) => object
                .properties
                .iter()
                .map(|property| FileStep::Use {
                    use_: &property.r#type,
                    path: Some(self.extend(path, &property.name)),
                    origin: Some(&property.origin),
                })
                .collect(),
            KnownSchemaRef::Map(map) => vec![FileStep::Use {
                use_: &map.values,
                path,
                origin: Some(&map.origin),
            }],
            KnownSchemaRef::Union(union) => union
                .variants
                .iter()
                .map(|variant| FileStep::Schema {
                    id: variant.schema.as_str(),
                    path: Some(self.extend(path, &variant.tag)),
                })
                .collect(),
        };

        Ok(steps)
    }

    /// The index of a new segment below `parent`.
    fn extend(&mut self, parent: Option<usize>, member: &'draft str) -> usize {
        self.segments.push(PathSegment { parent, member });

        self.segments.len() - 1
    }

    /// The dot-joined members of a path; a member after an empty path is not preceded by a dot.
    fn render(&self, path: Option<usize>) -> String {
        let mut members: Vec<&str> = Vec::new();
        let mut at = path;

        while let Some(segment) = at.and_then(|index| self.segments.get(index)) {
            members.push(segment.member);
            at = segment.parent;
        }

        let mut rendered = String::new();

        for member in members.into_iter().rev() {
            if !rendered.is_empty() {
                rendered.push('.');
            }

            rendered.push_str(member);
        }

        rendered
    }
}

// Every file reached from `type_use` (a file itself included), through schemas, items, map values, union variants
// and the schema of a JSON text field; each at its path below `type_use`, located at the nearest property, else
// `use_origin`.
fn files_below<'draft>(
    type_use: &'draft TypeUse,
    use_origin: Option<&'draft Origin>,
    scope: &TreeNodesScope<'draft, '_, '_>,
) -> Result<Vec<NestedFile>, PassError> {
    let mut walk = FileWalk {
        draft: scope.draft,
        found: Vec::new(),
        visited: HashSet::new(),
        segments: Vec::new(),
    };

    walk.walk(FileStep::Use {
        use_: type_use,
        path: None,
        origin: use_origin,
    })?;

    Ok(walk.found)
}

/// The ids input of a batch op that writes no input: the schema `tree.schemas` hoists for it, asked at the op
/// entry, located there.
pub(crate) fn tree_nodes_batch_input(
    node: &TreeNode<'_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperationInput>, PassError> {
    let schema = tree_nodes_answered_use(scope.schemas, &node.pointer, &Direction::Input)?;

    Ok(Some(DraftOperationInput {
        media: JSON_MEDIA,
        schema,
        body_limit_bytes: None,
        raw_body: None,
        fields: None,
        proofs: None,
        origin: node.origin.clone(),
    }))
}

// Where the input schema sits, which keys the wire of each of its fields: the declared schema it names (a string or
// `{ $ref: X }`), or the route's own inline input. A field is asked at its position there, not at its origin, which
// for a derived field or one from another layer is elsewhere.
fn input_schema_pointer(node: &TreeNode<'_>, schema_id: &str) -> String {
    let written = node.settings.get("input");
    let names_schema = matches!(written, Some(JsonValue::String(_)))
        || matches!(
            tree_nodes_member(written, REF_KEY),
            Some(JsonValue::String(_))
        );

    if names_schema {
        return pointer_below("/schemas", &[schema_id]);
    }

    format!("{}/input", node.pointer)
}

fn media_word(media: &InputMediaType) -> &str {
    MEDIA_WORD
        .iter()
        .find(|(known, _)| known == media)
        .map_or_else(|| media.as_str(), |(_, word)| *word)
}

// The fields of a form or multipart input: each property of its object schema, with its wire. `None`, with a
// diagnostic, when the input is no object schema.
fn form_fields(
    site: &InputSite<'_, '_>,
    schema: &TypeUse,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Vec<InputField>>, PassError> {
    let draft = scope.draft;
    let declared = match schema {
        TypeUse::Ref(reference) => tree_nodes_schema(draft, reference.schema.as_str()),
        _ => None,
    };
    let Some(Schema::Object(declared)) = declared else {
        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::FormInput,
                origin: site.origin.clone(),
                message: format!(
                    "The {} input of {} is not an object schema, so it has no fields.",
                    media_word(&site.media),
                    site.operation_id
                ),
                fix: "Declare the input as an object whose properties are the fields.".to_owned(),
                related: Vec::new(),
            }));

        return Ok(None);
    };
    let schema_pointer = input_schema_pointer(site.node, declared.id.as_str());
    let mut fields = Vec::new();

    for property in &declared.properties {
        let field_pointer = pointer_below(&schema_pointer, &["properties", &property.name]);

        if let Some(wire) = field_wire(site, property, &field_pointer, scope)? {
            fields.push(InputField {
                name: property.name.clone(),
                wire,
            });
        }
    }

    Ok(Some(fields))
}

fn field_wire(
    site: &InputSite<'_, '_>,
    property: &Property,
    field_pointer: &str,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<FieldWire>, PassError> {
    let at = tree_nodes_locate(&property.origin, &site.origin);

    if tree_nodes_is_file_field(&property.r#type) {
        check_file_field(site, property, &at, scope)?;
    } else {
        let nested = files_below(&property.r#type, Some(&property.origin), scope)?;

        report_nested_files(site, &nested, Some(&property.name), scope);

        if !nested.is_empty() {
            return Ok(None);
        }
    }

    let wire = if matches!(property.r#type, TypeUse::Opaque(_)) {
        None
    } else {
        tree_nodes_field_wire_of(field_pointer, &property.r#type, scope.schemas)?
    };

    if wire.is_none() {
        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::FormField,
                origin: at,
                message: format!(
                    "The field {} of the {} input of {} has no form encoding.",
                    property.name,
                    media_word(&site.media),
                    site.operation_id
                ),
                fix: "Give the field a number, boolean, text, list or object schema, a file in multipart, or JSON text (contentMediaType: application/json)."
                    .to_owned(),
                related: Vec::new(),
            }));
    }

    Ok(wire)
}

// A file field: only in multipart, each file within the route's body limit.
fn check_file_field(
    site: &InputSite<'_, '_>,
    property: &Property,
    at: &DiagnosticOrigin,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    if site.media != MULTIPART_MEDIA {
        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::InputFile,
                origin: at.clone(),
                message: format!(
                    "The form input of {} holds the file field {}, but a form body carries no file.",
                    site.operation_id, property.name
                ),
                fix: "Set inputMedia: multipart, which carries files.".to_owned(),
                related: Vec::new(),
            }));

        return Ok(());
    }

    let file = match &property.r#type {
        TypeUse::Array(array) => &*array.items,
        other => other,
    };
    let max_size = match file {
        TypeUse::File(file) => file.max_size_bytes,
        _ => None,
    };
    let limit = tree_nodes_body_limit(
        site.node_id,
        site.node,
        &TreeNodesBodyLimitContext {
            inherited: scope.context.inherited,
            conventions: scope.context.conventions,
        },
    )?;
    let (Some(max_size), Some(limit)) = (max_size, limit) else {
        return Ok(());
    };

    if max_size <= limit.bytes {
        return Ok(());
    }

    let related = limit
        .origin
        .iter()
        .map(|origin| RelatedLocation {
            origin: tree_nodes_locate(origin, &site.origin),
            message: "the body limit".to_owned(),
        })
        .collect();

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::InputFileSize,
            origin: at.clone(),
            message: format!(
                "The file field {} of {} allows {max_size} bytes, more than the route's body limit of {} bytes.",
                property.name, site.operation_id, limit.bytes
            ),
            fix: "Raise bodyLimit on the route, or lower the file's maxSize.".to_owned(),
            related,
        }));

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::thread;

    use seampact_ir::{IrMap, Schema, SchemaId, TypeUse};
    use seampact_pipeline::DraftIr;
    use serde_json::{Value, json};

    use super::{FileStep, FileWalk, NestedFile};

    const FILE: fn() -> Value = || json!({"kind": "file", "media": []});
    const SMALL_STACK_BYTES: usize = 2 * 1024 * 1024;

    fn property(name: &str, type_use: &Value) -> Value {
        json!({
            "name": name, "type": type_use, "optional": false, "nullable": false,
            "sensitive": false, "deprecated": false, "docs": {}, "extensions": {},
            "origin": {"layer": "api", "pointer": "/schemas"},
        })
    }

    fn object(id: &str, properties: &[Value]) -> (String, Value) {
        let schema = json!({
            "id": id,
            "name": {"segments": [id], "role": "schema"},
            "directions": ["input"],
            "examples": [], "docs": {}, "extensions": {},
            "origin": {"layer": "api", "pointer": "/schemas"},
            "kind": "object", "properties": properties,
        });

        (id.to_owned(), schema)
    }

    fn reference(id: &str) -> Value {
        json!({"kind": "ref", "schema": id})
    }

    fn draft_of(schemas: Vec<(String, Value)>) -> DraftIr {
        let entries: serde_json::Map<String, Value> = schemas.into_iter().collect();
        let catalogue: IrMap<SchemaId, Schema> =
            serde_json::from_value(Value::Object(entries)).expect("schemas");
        let mut draft = DraftIr::new();

        draft.schemas = catalogue;

        draft
    }

    fn files_below_ref(draft: &DraftIr, root: &str) -> Vec<NestedFile> {
        let start: TypeUse = serde_json::from_value(reference(root)).expect("use");
        let mut walk = FileWalk {
            draft,
            found: Vec::new(),
            visited: HashSet::new(),
            segments: Vec::new(),
        };

        walk.walk(FileStep::Use {
            use_: &start,
            path: None,
            origin: None,
        })
        .expect("walk");

        walk.found
    }

    fn paths(files: &[NestedFile]) -> Vec<&str> {
        files.iter().map(|file| file.path.as_str()).collect()
    }

    #[test]
    fn a_path_below_the_top_level_is_dot_joined_in_walk_order() {
        let draft = draft_of(vec![
            object(
                "Root",
                &[
                    property("first", &FILE()),
                    property("inner", &reference("Inner")),
                    property("", &reference("Blank")),
                    property("last", &FILE()),
                ],
            ),
            object("Inner", &[property("deep", &FILE())]),
            object(
                "Blank",
                &[property("under", &FILE()), property("", &FILE())],
            ),
        ]);

        // A member written after an empty path is not preceded by a dot, and one written after a
        // path is, even when it is empty.
        assert_eq!(
            paths(&files_below_ref(&draft, "Root")),
            ["first", "inner.deep", "under", "", "last"]
        );
    }

    #[test]
    fn a_long_schema_chain_ending_in_a_file_is_walked_without_overflowing_the_stack() {
        const LINKS: usize = 100_000;

        let found = thread::Builder::new()
            .stack_size(SMALL_STACK_BYTES)
            .spawn(|| {
                let mut schemas: Vec<(String, Value)> = (0..LINKS)
                    .map(|index| {
                        object(
                            &format!("N{index}"),
                            &[property("n", &reference(&format!("N{}", index + 1)))],
                        )
                    })
                    .collect();

                schemas.push(object(&format!("N{LINKS}"), &[property("file", &FILE())]));

                let draft = draft_of(schemas);

                files_below_ref(&draft, "N0")
                    .into_iter()
                    .map(|file| file.path.len())
                    .collect::<Vec<usize>>()
            })
            .expect("thread")
            .join();

        // LINKS members "n" with a dot between each, then the dot and "file".
        assert_eq!(
            found.ok(),
            Some(vec![LINKS * 2 + "file".len()]),
            "the walk of {LINKS} links found the file"
        );
    }
}
