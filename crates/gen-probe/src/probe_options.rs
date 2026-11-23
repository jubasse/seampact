//! The options every probe reads.

use seampact_ir::OperationId;
use seampact_target::{DescriptorSet, GenerateWarning, GeneratedFile, Refusal, Refused};
use serde::Deserialize;

/// `{ files?, refusals?, warnings?, echo?, descriptors?, unsupportedKind? }`; the twins read no
/// other member and refuse nothing, so neither does this.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOptions {
    /// The files to write.
    #[serde(default)]
    pub files: Vec<GeneratedFile>,
    /// The refusals to answer instead of files or descriptors.
    #[serde(default)]
    pub refusals: Option<Vec<ProbeRefusal>>,
    /// The warnings to answer beside the files.
    #[serde(default)]
    pub warnings: Option<Vec<GenerateWarning>>,
    /// Whether to write `request.json`.
    #[serde(default)]
    pub echo: Option<bool>,
    /// What a provider's `describe` answers.
    #[serde(default)]
    pub descriptors: Option<DescriptorSet>,
    /// Whether the client probe refuses every declaration kind.
    #[serde(default)]
    pub unsupported_kind: Option<bool>,
}

/// A refusal as the options write it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ProbeRefusal {
    code: String,
    message: String,
    fix: String,
    #[serde(default)]
    operation: Option<OperationId>,
    #[serde(default)]
    member: Option<String>,
    #[serde(default)]
    docs: Option<String>,
}

impl ProbeOptions {
    /// The refusals the options ask for, if any.
    #[must_use]
    pub fn refused(&self) -> Option<Refused> {
        let refusals = self.refusals.as_ref()?;

        Some(Refused(
            refusals.iter().cloned().map(Refusal::from).collect(),
        ))
    }
}

impl From<ProbeRefusal> for Refusal {
    fn from(refusal: ProbeRefusal) -> Self {
        Self {
            operation: refusal.operation,
            member: refusal.member,
            docs: refusal.docs,
            ..Self::new(refusal.code, refusal.message, refusal.fix)
        }
    }
}
