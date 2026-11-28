//! The `diff` settings of an app config, read into the types the diff takes.

use seampact_diagnostics::InternalError;
use seampact_diff_table::{DiffExemption, DiffGateScope, DiffOptions};
use seampact_json::{JsonValue, from_json_value};
use serde::Deserialize;

/// The `gate` and `exempt` members of an app's `diff` settings; a member the config does not
/// write is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiffSettings {
    /// Which broken sides fail `additive-only`.
    pub gate: Option<DiffGateScope>,
    /// The breaking changes reported but not gated.
    pub exempt: Option<Vec<DiffExemption>>,
}

// The members as the config writes them, before their texts name a scope and an exemption.
#[derive(Deserialize)]
struct WrittenDiffSettings {
    gate: Option<String>,
    exempt: Option<Vec<String>>,
}

impl DiffSettings {
    /// The settings of a `diff` value the config schema passed.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value is no mapping, or holds a gate or an exemption the
    /// schema does not allow.
    pub fn from_value(value: &JsonValue) -> Result<Self, InternalError> {
        let written: WrittenDiffSettings = from_json_value(value).map_err(|error| {
            InternalError::new(format!(
                "diff settings outside the schema's passed it: {error}"
            ))
        })?;
        let gate = written
            .gate
            .map(|text| {
                DiffGateScope::from_text(&text).ok_or_else(|| {
                    InternalError::new(format!("a diff gate '{text}' passed the schema"))
                })
            })
            .transpose()?;
        let exempt = written
            .exempt
            .map(|texts| {
                texts
                    .iter()
                    .map(|text| {
                        DiffExemption::from_text(text).ok_or_else(|| {
                            InternalError::new(format!(
                                "a diff exemption '{text}' passed the schema"
                            ))
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;

        Ok(Self { gate, exempt })
    }

    /// The options of a diff run on `today`.
    #[must_use]
    pub fn into_options(self, today: String) -> DiffOptions {
        DiffOptions {
            today,
            gate: self.gate,
            exempt: self.exempt,
        }
    }
}
