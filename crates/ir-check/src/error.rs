//! The errors of building the validators and converting a value.

use seampact_ir::IrError;

/// A failure of the check itself, never a finding about the document checked.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum IrCheckError {
    /// An embedded schema file is not JSON, does not register or does not compile.
    #[error("the IR schemas are broken: {what}")]
    BrokenSchemas {
        /// What is wrong.
        what: String,
    },

    /// A number has no `serde_json` form.
    #[error("the number '{number}' at '{pointer}' has no finite f64 form")]
    NumberNotFinite {
        /// Where the number sits.
        pointer: String,
        /// The number's text.
        number: String,
    },
}

impl From<IrError> for IrCheckError {
    fn from(error: IrError) -> Self {
        Self::BrokenSchemas {
            what: error.to_string(),
        }
    }
}
