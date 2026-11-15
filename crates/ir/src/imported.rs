//! An imported api's IR as read: the open typed form beside the document it decodes from, so the
//! closed check sees the members the typed form drops.

use seampact_json::JsonValue;

use crate::{ContractIr, IrError};

/// An imported api's IR: the typed open form and the JSON document it was read from.
///
/// The typed form drops on decode an object member its types do not declare; the document keeps
/// it, for [`crate::check_ir_closed_declaration`] to report.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportedIr {
    contract: ContractIr,
    document: JsonValue,
}

impl ImportedIr {
    /// Reads an imported api's IR from its JSON text, keeping the document as read.
    ///
    /// # Errors
    ///
    /// [`IrError::Decode`] when the text is no IR document of the known types.
    pub fn from_json_text(text: &str) -> Result<Self, IrError> {
        let contract = ContractIr::from_json_text(text)?;
        let document: JsonValue = serde_json::from_str(text).map_err(IrError::Decode)?;

        Ok(Self { contract, document })
    }

    /// The import of an IR this compiler wrote: its canonical text read back, so the document
    /// holds only what the typed form holds.
    ///
    /// # Errors
    ///
    /// As [`ContractIr::canonical_text`] and [`ImportedIr::from_json_text`].
    pub fn from_contract(contract: &ContractIr) -> Result<Self, IrError> {
        Self::from_json_text(&contract.canonical_text()?)
    }

    /// The typed open form: an IR from another compiler version may hold a variant or a value
    /// this one does not know.
    #[must_use]
    pub const fn contract(&self) -> &ContractIr {
        &self.contract
    }

    /// The document as read, unknown members included.
    #[must_use]
    pub const fn document(&self) -> &JsonValue {
        &self.document
    }
}
