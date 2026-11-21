//! The codes of the diff's refusals and gate failures.

/// A code of a refusal or a gate failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DiffCode {
    /// `diff.irVersion.differs`.
    IrVersionDiffers,
    /// `diff.irRevision.differs`.
    IrRevisionDiffers,
    /// `diff.api.name.differs`.
    ApiNameDiffers,
    /// `diff.api.version.differs`.
    ApiVersionDiffers,
    /// `diff.ir.unknownValue`.
    UnknownValue,
    /// `diff.policy.breaking`.
    PolicyBreaking,
    /// `diff.maturity.stable`.
    MaturityStable,
}

impl DiffCode {
    /// The code text.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::IrVersionDiffers => "diff.irVersion.differs",
            Self::IrRevisionDiffers => "diff.irRevision.differs",
            Self::ApiNameDiffers => "diff.api.name.differs",
            Self::ApiVersionDiffers => "diff.api.version.differs",
            Self::UnknownValue => "diff.ir.unknownValue",
            Self::PolicyBreaking => "diff.policy.breaking",
            Self::MaturityStable => "diff.maturity.stable",
        }
    }
}

/// `DIFF_CODES`: each code under its TypeScript member name, in declaration order.
pub(crate) static DIFF_CODES: [(&str, DiffCode); 7] = [
    ("irVersionDiffers", DiffCode::IrVersionDiffers),
    ("irRevisionDiffers", DiffCode::IrRevisionDiffers),
    ("apiNameDiffers", DiffCode::ApiNameDiffers),
    ("apiVersionDiffers", DiffCode::ApiVersionDiffers),
    ("unknownValue", DiffCode::UnknownValue),
    ("policyBreaking", DiffCode::PolicyBreaking),
    ("maturityStable", DiffCode::MaturityStable),
];
