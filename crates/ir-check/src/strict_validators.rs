//! The IR schemas in their strict and open forms, each compiled once; the strict one is `shared`.

use std::sync::OnceLock;

use jsonschema::{Draft, Registry, Resource, Validator};
use seampact_ir::{IR_SCHEMA_FILES, IrSchemaFile};
use serde_json::Value;

use crate::IrCheckError;

const ID_KEYWORD: &str = "$id";
const IR_SCHEMA_FILE: &str = "ir.schema.json";
const SOURCE_MAP_SCHEMA_FILE: &str = "source-map.schema.json";

/// The keywords whose value is a map of subschemas.
const SCHEMA_MAPS: [&str; 2] = ["$defs", "properties"];
/// The keywords whose value is one subschema.
const SCHEMA_VALUES: [&str; 3] = ["items", "additionalProperties", "propertyNames"];
/// The keywords whose value is a list of subschemas.
const SCHEMA_LISTS: [&str; 1] = ["oneOf"];

/// How the schema documents are read: as published, or with every object shape closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchemaForm {
    Open,
    Strict,
}

/// The validators of the IR document and of the source map, in one form.
pub(crate) struct SchemaValidators {
    ir: Validator,
    source_map: Validator,
}

static OPEN_VALIDATORS: OnceLock<Result<SchemaValidators, IrCheckError>> = OnceLock::new();
static STRICT_VALIDATORS: OnceLock<Result<SchemaValidators, IrCheckError>> = OnceLock::new();

fn broken(what: String) -> IrCheckError {
    IrCheckError::BrokenSchemas { what }
}

fn schema_document(file: &IrSchemaFile) -> Result<Value, IrCheckError> {
    serde_json::from_str(file.text)
        .map_err(|error| broken(format!("{} is not JSON: {error}", file.name)))
}

// Closes every object shape (`additionalProperties: false` beside its `properties`), as the strict
// form of the IR schemas is: maps keep their value schema and opaque values stay open.
fn close_objects(node: &mut Value) {
    let Some(members) = node.as_object_mut() else {
        return;
    };

    if members.get("properties").is_some_and(Value::is_object) {
        members.insert("additionalProperties".to_owned(), Value::Bool(false));
    }

    for keyword in SCHEMA_MAPS {
        if let Some(Value::Object(children)) = members.get_mut(keyword) {
            for child in children.values_mut() {
                close_objects(child);
            }
        }
    }

    for keyword in SCHEMA_VALUES {
        if let Some(child) = members.get_mut(keyword) {
            close_objects(child);
        }
    }

    for keyword in SCHEMA_LISTS {
        if let Some(Value::Array(children)) = members.get_mut(keyword) {
            for child in children {
                close_objects(child);
            }
        }
    }
}

fn document_id(file: &IrSchemaFile, document: &Value) -> Result<String, IrCheckError> {
    document
        .get(ID_KEYWORD)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| broken(format!("{} has no $id", file.name)))
}

fn compile(
    registry: &Registry<'_>,
    documents: &[(&IrSchemaFile, Value)],
    name: &str,
) -> Result<Validator, IrCheckError> {
    let document = documents
        .iter()
        .find(|(file, _)| file.name == name)
        .map(|(_, document)| document)
        .ok_or_else(|| broken(format!("no schema file {name}")))?;

    jsonschema::options()
        .with_draft(Draft::Draft202012)
        .with_registry(registry)
        .should_validate_formats(false)
        .build(document)
        .map_err(|error| broken(format!("{name} does not compile: {error}")))
}

impl SchemaValidators {
    fn build(form: SchemaForm) -> Result<Self, IrCheckError> {
        let mut documents = Vec::new();
        let mut builder = Registry::new().draft(Draft::Draft202012);

        for file in IR_SCHEMA_FILES {
            let mut document = schema_document(file)?;

            if form == SchemaForm::Strict {
                close_objects(&mut document);
            }

            let id = document_id(file, &document)?;

            builder = builder
                .add(&id, Resource::from_contents(document.clone()))
                .map_err(|error| broken(format!("{id} is not registered: {error}")))?;
            documents.push((file, document));
        }

        let registry = builder
            .prepare()
            .map_err(|error| broken(format!("the schemas are not prepared: {error}")))?;

        Ok(Self {
            ir: compile(&registry, &documents, IR_SCHEMA_FILE)?,
            source_map: compile(&registry, &documents, SOURCE_MAP_SCHEMA_FILE)?,
        })
    }

    /// The compiled schemas as published, built on first use.
    pub(crate) fn open() -> Result<&'static Self, IrCheckError> {
        OPEN_VALIDATORS
            .get_or_init(|| Self::build(SchemaForm::Open))
            .as_ref()
            .map_err(Clone::clone)
    }

    /// The compiled strict schemas, built on first use.
    pub(crate) fn shared() -> Result<&'static Self, IrCheckError> {
        STRICT_VALIDATORS
            .get_or_init(|| Self::build(SchemaForm::Strict))
            .as_ref()
            .map_err(Clone::clone)
    }

    pub(crate) fn ir(&self) -> &Validator {
        &self.ir
    }

    pub(crate) fn source_map(&self) -> &Validator {
        &self.source_map
    }
}
