//! The probe adapter: a generator whose answers are its options.

use seampact_ir::ContractIr;
use seampact_json::JsonValue;
use seampact_target::{
    DescriptorSet, GenerateInput, Generated, GeneratedFile, Refusal, Refused, TargetDefinition,
    TargetMetadata,
};

use crate::ProbeOptions;
use crate::request_echo::{REQUEST_FILE, request_text};

/// A probe generator: its metadata, and the answers its options give.
#[derive(Debug)]
pub struct Probe {
    metadata: TargetMetadata,
}

impl Probe {
    /// The probe of `metadata`.
    #[must_use]
    pub const fn new(metadata: TargetMetadata) -> Self {
        Self { metadata }
    }
}

impl TargetDefinition for Probe {
    type Options = ProbeOptions;

    fn metadata(&self) -> &TargetMetadata {
        &self.metadata
    }

    fn parse_options(&self, raw: Option<&JsonValue>) -> Result<ProbeOptions, Refused> {
        ProbeOptions::parse(raw)
    }

    fn generate(&self, input: &GenerateInput<'_, ProbeOptions>) -> Result<Generated, Refused> {
        let options = &input.options;

        if let Some(refused) = options.refused() {
            return Err(refused);
        }

        let mut files = options.files.clone();

        if options.echo == Some(true) {
            let contents = request_text(input, &self.metadata).map_err(|error| {
                Refused(vec![Refusal {
                    code: "probe.echo.failed".to_owned(),
                    message: format!("The request could not be written as JSON: {error}."),
                    fix: "Report it: every request member is JSON.".to_owned(),
                    operation: None,
                    member: None,
                    docs: None,
                }])
            })?;

            files.push(GeneratedFile {
                path: REQUEST_FILE.to_owned(),
                contents,
            });
        }

        Ok(Generated {
            files,
            warnings: options.warnings.clone().unwrap_or_default(),
        })
    }

    fn describe(&self, _ir: &ContractIr, options: &ProbeOptions) -> Result<DescriptorSet, Refused> {
        if let Some(refused) = options.refused() {
            return Err(refused);
        }

        Ok(options.descriptors.clone().unwrap_or_default())
    }
}
