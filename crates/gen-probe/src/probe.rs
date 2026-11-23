//! The probe adapter: a generator whose answers are its options.

use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;
use seampact_json::JsonValue;
use seampact_target::{
    DescriptorSet, GenerateInput, Generated, GeneratedFile, TargetDefinition, TargetFailure,
    TargetMetadata, parse_options,
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

    fn parse_options(&self, raw: Option<&JsonValue>) -> Result<ProbeOptions, TargetFailure> {
        Ok(parse_options(raw)?)
    }

    fn generate(
        &self,
        input: &GenerateInput<'_, ProbeOptions>,
    ) -> Result<Generated, TargetFailure> {
        let options = &input.options;

        if let Some(refused) = options.refused() {
            return Err(refused.into());
        }

        let mut files = options.files.clone();

        if options.echo == Some(true) {
            let contents = request_text(input, &self.metadata).map_err(|error| {
                InternalError::new(format!("the probe request is not JSON: {error}"))
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

    fn describe(
        &self,
        _ir: &ContractIr,
        options: &ProbeOptions,
    ) -> Result<DescriptorSet, TargetFailure> {
        if let Some(refused) = options.refused() {
            return Err(refused.into());
        }

        Ok(options.descriptors.clone().unwrap_or_default())
    }
}
