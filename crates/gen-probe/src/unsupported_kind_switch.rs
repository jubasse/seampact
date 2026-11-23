//! The client probe: one of two probes, chosen by the `unsupportedKind` option.

use seampact_ir::ContractIr;
use seampact_json::JsonValue;
use seampact_target::{
    DescriptorSet, GenerateRequest, Generated, Generator, TargetFailure, TargetMetadata,
    parse_options,
};

use crate::{Probe, ProbeOptions};

/// Runs the refusing probe when the options hold `unsupportedKind: true`, the supporting one
/// otherwise, as the client twin does.
#[derive(Debug)]
pub struct UnsupportedKindSwitch {
    supporting: &'static Probe,
    refusing: &'static Probe,
}

impl UnsupportedKindSwitch {
    /// The switch between `supporting` and `refusing`.
    #[must_use]
    pub const fn new(supporting: &'static Probe, refusing: &'static Probe) -> Self {
        Self {
            supporting,
            refusing,
        }
    }

    fn chosen(&self, options: Option<&JsonValue>) -> &'static Probe {
        let asks_refusal = parse_options::<ProbeOptions>(options)
            .is_ok_and(|options| options.unsupported_kind == Some(true));

        if asks_refusal {
            self.refusing
        } else {
            self.supporting
        }
    }
}

impl Generator for UnsupportedKindSwitch {
    fn metadata(&self) -> &TargetMetadata {
        Generator::metadata(self.supporting)
    }

    fn generate(&self, request: &GenerateRequest<'_>) -> Result<Generated, TargetFailure> {
        Generator::generate(self.chosen(request.options), request)
    }

    fn describe(
        &self,
        ir: &ContractIr,
        options: &JsonValue,
    ) -> Result<DescriptorSet, TargetFailure> {
        Generator::describe(self.supporting, ir, options)
    }
}
