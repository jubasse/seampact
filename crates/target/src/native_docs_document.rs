//! The parsed seampact OpenAPI document a target turns into its framework's own docs.

use seampact_json::JsonObject;
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

/// The api's document the `nativeDocs` artefact follows; `name` is the `api.documents` key it was
/// emitted for, absent for an api that declares none.
#[derive(Debug, Clone, PartialEq)]
pub struct NativeDocsDocument {
    /// The document's name.
    pub name: Option<String>,
    /// The parsed document.
    pub document: JsonObject,
}

/// The document as a JSON object; `serde_json` only, as [`seampact_json::JsonValue`].
struct DocumentMembers<'document>(&'document JsonObject);

impl Serialize for DocumentMembers<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.0.iter())
    }
}

impl Serialize for NativeDocsDocument {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;

        if let Some(name) = &self.name {
            map.serialize_entry("name", name)?;
        }

        map.serialize_entry("document", &DocumentMembers(&self.document))?;
        map.end()
    }
}
