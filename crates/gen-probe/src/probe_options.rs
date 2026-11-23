//! The options every probe reads.

use seampact_ir::OperationId;
use seampact_json::JsonValue;
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
    /// Reads the raw options; absent options are `{}`.
    ///
    /// # Errors
    ///
    /// An `options.invalid` refusal when the options do not have the probes' shape.
    pub fn parse(raw: Option<&JsonValue>) -> Result<Self, Refused> {
        let Some(raw) = raw else {
            return Ok(Self::default());
        };

        serde_json::to_value(raw)
            .and_then(serde_json::from_value)
            .map_err(|error| {
                Refused(vec![Refusal {
                    code: "options.invalid".to_owned(),
                    message: format!("The probe options do not have the probes' shape: {error}."),
                    fix: "Write the options of generators.md section 2.".to_owned(),
                    operation: None,
                    member: Some(String::new()),
                    docs: None,
                }])
            })
    }

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
            code: refusal.code,
            message: refusal.message,
            fix: refusal.fix,
            operation: refusal.operation,
            member: refusal.member,
            docs: refusal.docs,
        }
    }
}
