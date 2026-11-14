//! The authoring schemas compiled once, a validator per document kind on first use.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::OnceLock;

use jsonschema::{Draft, Registry, Resource, Uri, Validator};
use seampact_authoring::{AUTHORING_SCHEMA_FILES, AuthoringSchemaFile};
use seampact_diagnostics::InternalError;
use serde_json::Value;

/// An absolute base for the relative `$ref`s between the authoring schemas; never fetched.
const BASE_URI: &str = "https://seampact.invalid/authoring/";

const ID_KEYWORD: &str = "$id";

/// The authoring schemas: their documents by URI and a validator per kind.
pub(crate) struct AuthoringValidators {
    documents: HashMap<String, Value>,
    validators: HashMap<&'static str, Validator>,
}

static AUTHORING_VALIDATORS: OnceLock<Result<AuthoringValidators, InternalError>> = OnceLock::new();

fn schema_uri(file: &AuthoringSchemaFile) -> String {
    format!("{BASE_URI}{}", file.file_name)
}

fn schema_document(file: &AuthoringSchemaFile) -> Result<Value, InternalError> {
    let mut document: Value = serde_json::from_str(file.text).map_err(|error| {
        InternalError::new(format!(
            "the authoring schema {} is not JSON: {error}",
            file.file_name
        ))
    })?;
    let Some(members) = document.as_object_mut() else {
        return Err(InternalError::new(format!(
            "the authoring schema {} is not an object",
            file.file_name
        )));
    };

    members.insert(ID_KEYWORD.to_owned(), Value::String(schema_uri(file)));

    Ok(document)
}

impl AuthoringValidators {
    fn build() -> Result<Self, InternalError> {
        let mut documents = HashMap::new();
        let mut builder = Registry::new().draft(Draft::Draft202012);

        for file in AUTHORING_SCHEMA_FILES {
            let document = schema_document(file)?;
            let uri = schema_uri(file);

            builder = builder
                .add(&uri, Resource::from_contents(document.clone()))
                .map_err(|error| {
                    InternalError::new(format!("the schema {uri} is not registered: {error}"))
                })?;
            documents.insert(uri, document);
        }

        let registry = builder.prepare().map_err(|error| {
            InternalError::new(format!("the authoring schemas are not prepared: {error}"))
        })?;
        let mut validators = HashMap::new();

        for file in AUTHORING_SCHEMA_FILES {
            let document = documents
                .get(&schema_uri(file))
                .ok_or_else(|| InternalError::new(format!("no document for {}", file.file_name)))?;
            let validator = jsonschema::options()
                .with_draft(Draft::Draft202012)
                .with_registry(&registry)
                .should_validate_formats(false)
                .build(document)
                .map_err(|error| {
                    InternalError::new(format!(
                        "the authoring schema {} does not compile: {error}",
                        file.file_name
                    ))
                })?;

            validators.insert(file.kind, validator);
        }

        Ok(Self {
            documents,
            validators,
        })
    }

    /// The compiled authoring schemas, built on first use.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] when an embedded schema does not compile.
    pub(crate) fn shared() -> Result<&'static Self, InternalError> {
        AUTHORING_VALIDATORS
            .get_or_init(Self::build)
            .as_ref()
            .map_err(Clone::clone)
    }

    pub(crate) fn validator_for(&self, kind: &str) -> Result<&Validator, InternalError> {
        self.validators
            .get(kind)
            .ok_or_else(|| InternalError::new(format!("no authoring schema for {kind}")))
    }

    /// The schema a keyword location (`<file>#<pointer>`) names: the keyword's value.
    pub(crate) fn schema_at(&self, location: &Uri<String>) -> Option<&Value> {
        let document = self.documents.get(&document_uri(location))?;

        document.pointer(&fragment_pointer(location)?)
    }

    /// The schema object that holds the keyword a location names.
    pub(crate) fn parent_schema_at(&self, location: &Uri<String>) -> Option<&Value> {
        let document = self.documents.get(&document_uri(location))?;
        let pointer = fragment_pointer(location)?;
        let (parent, _keyword) = pointer.rsplit_once('/')?;

        document.pointer(parent)
    }
}

// The document a location is in: the location without its fragment.
fn document_uri(location: &Uri<String>) -> String {
    let text = location.as_str();

    text.split_once('#')
        .map_or(text, |(document, _)| document)
        .to_owned()
}

// The fragment as a JSON Pointer; `None` when it is not valid UTF-8 once decoded.
fn fragment_pointer(location: &Uri<String>) -> Option<String> {
    let fragment = location.fragment()?;

    fragment.decode().to_string().ok().map(Cow::into_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_authoring_schema_compiles_into_a_validator() -> Result<(), InternalError> {
        let validators = AuthoringValidators::shared()?;

        for file in AUTHORING_SCHEMA_FILES {
            validators.validator_for(file.kind)?;
        }

        Ok(())
    }

    #[test]
    fn an_unknown_kind_has_no_validator() -> Result<(), InternalError> {
        let validators = AuthoringValidators::shared()?;

        assert!(validators.validator_for("nowhere").is_err());

        Ok(())
    }
}
