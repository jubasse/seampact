//! The two document roots, the IR and the source map, read from and written to JSON.

use seampact_json::{JsonValue, canonical_document};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::{ContractIr, IrError, SourceMap};

impl ContractIr {
    /// Reads an IR document from its JSON text; unknown members are dropped.
    ///
    /// # Errors
    ///
    /// [`IrError::Decode`] when the text is no IR document of the known types.
    pub fn from_json_text(text: &str) -> Result<Self, IrError> {
        from_json_text(text)
    }

    /// The document as a JSON value, for the canonical writer.
    ///
    /// # Errors
    ///
    /// [`IrError::Encode`] or [`IrError::Value`] when a member does not encode.
    pub fn to_json_value(&self) -> Result<JsonValue, IrError> {
        to_json_value(self)
    }

    /// The IR bytes: the canonical text of the document.
    ///
    /// # Errors
    ///
    /// As [`ContractIr::to_json_value`].
    pub fn canonical_text(&self) -> Result<String, IrError> {
        self.to_json_value().map(|value| canonical_document(&value))
    }
}

impl SourceMap {
    /// Reads a source map from its JSON text; unknown members are dropped.
    ///
    /// # Errors
    ///
    /// [`IrError::Decode`] when the text is no source map.
    pub fn from_json_text(text: &str) -> Result<Self, IrError> {
        from_json_text(text)
    }

    /// The source map as a JSON value, for the canonical writer.
    ///
    /// # Errors
    ///
    /// [`IrError::Encode`] or [`IrError::Value`] when a member does not encode.
    pub fn to_json_value(&self) -> Result<JsonValue, IrError> {
        to_json_value(self)
    }

    /// The source-map bytes: the canonical text of the document.
    ///
    /// # Errors
    ///
    /// As [`SourceMap::to_json_value`].
    pub fn canonical_text(&self) -> Result<String, IrError> {
        self.to_json_value().map(|value| canonical_document(&value))
    }
}

fn from_json_text<T: DeserializeOwned>(text: &str) -> Result<T, IrError> {
    serde_json::from_str(text).map_err(IrError::Decode)
}

fn to_json_value<T: Serialize>(document: &T) -> Result<JsonValue, IrError> {
    let value = serde_json::to_value(document).map_err(IrError::Encode)?;

    Ok(JsonValue::try_from(value)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_and_sync<T: Send + Sync>() {}

    #[test]
    fn the_document_roots_are_send_and_sync() {
        assert_send_and_sync::<ContractIr>();
        assert_send_and_sync::<SourceMap>();
    }
}
