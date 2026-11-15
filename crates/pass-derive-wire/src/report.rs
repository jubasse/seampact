//! The diagnostics of the half (ADR 0006 section 4): rule `seampact/derive/<rule>`, located at a
//! pointer of the merged raw tree through the api's side table, with `related` naming the other
//! side of a conflict. A core default has no location, so a problem about one is located at the
//! route or the declaration that reaches it.

use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};
use seampact_pipeline::HalfContext;

/// The rules the half reports, each `seampact/derive/<rule>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeriveWireRule {
    IdempotencyConvention,
    IdempotencyExemptUnused,
    DerivedNameCollision,
    CacheMethod,
    CacheFamily,
    CacheFreshness,
    CacheSensitive,
    CacheSensitiveElsewhere,
    BucketLimits,
}

impl DeriveWireRule {
    /// Every rule the half reports.
    pub(crate) const ALL: &'static [Self] = &[
        Self::IdempotencyConvention,
        Self::IdempotencyExemptUnused,
        Self::DerivedNameCollision,
        Self::CacheMethod,
        Self::CacheFamily,
        Self::CacheFreshness,
        Self::CacheSensitive,
        Self::CacheSensitiveElsewhere,
        Self::BucketLimits,
    ];

    /// The rule id as `diagnostics.json` writes it.
    pub(crate) const fn rule_id(self) -> RuleId {
        RuleId::from_static(match self {
            Self::IdempotencyConvention => "seampact/derive/idempotency-convention",
            Self::IdempotencyExemptUnused => "seampact/derive/idempotency-exempt-unused",
            Self::DerivedNameCollision => "seampact/derive/derived-name-collision",
            Self::CacheMethod => "seampact/derive/cache-method",
            Self::CacheFamily => "seampact/derive/cache-family",
            Self::CacheFreshness => "seampact/derive/cache-freshness",
            Self::CacheSensitive => "seampact/derive/cache-sensitive",
            Self::CacheSensitiveElsewhere => "seampact/derive/cache-sensitive-elsewhere",
            Self::BucketLimits => "seampact/derive/bucket-limits",
        })
    }

    /// The rule as the setting-fault keys write it, after `seampact/derive/`.
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::IdempotencyConvention => "idempotency-convention",
            Self::IdempotencyExemptUnused => "idempotency-exempt-unused",
            Self::DerivedNameCollision => "derived-name-collision",
            Self::CacheMethod => "cache-method",
            Self::CacheFamily => "cache-family",
            Self::CacheFreshness => "cache-freshness",
            Self::CacheSensitive => "cache-sensitive",
            Self::CacheSensitiveElsewhere => "cache-sensitive-elsewhere",
            Self::BucketLimits => "bucket-limits",
        }
    }
}

/// A second location of a problem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveWireRelated {
    /// A pointer of the merged raw tree.
    pub(crate) pointer: String,
    pub(crate) message: String,
}

/// What a check found, before it is located and reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveWireProblem {
    pub(crate) rule: DeriveWireRule,
    pub(crate) message: String,
    pub(crate) fix: String,
    /// The pointer of the merged raw tree the diagnostic is located at.
    pub(crate) pointer: String,
    pub(crate) related: Vec<DeriveWireRelated>,
}

/// Reports the half's errors and warnings through its context, each located at its pointer.
pub(crate) struct DeriveWireReporter<'half, 'run> {
    context: &'half mut HalfContext<'run>,
}

impl DeriveWireReporter<'_, '_> {
    // Every pointer reported is one the half read from an authored layer, so it has an authored
    // origin.
    fn locate(&self, pointer: &str) -> Result<DiagnosticOrigin, InternalError> {
        let Some(origin) = self.context.origin(pointer) else {
            return Err(InternalError::new(format!(
                "derive.wire located a diagnostic at {pointer}, which has no origin"
            )));
        };

        DiagnosticOrigin::of(&origin).ok_or_else(|| {
            InternalError::new(format!(
                "derive.wire located a diagnostic at {pointer}, whose origin is the core, not an authored layer"
            ))
        })
    }

    fn report(
        &mut self,
        severity: Severity,
        problem: DeriveWireProblem,
    ) -> Result<(), InternalError> {
        let related = problem
            .related
            .iter()
            .map(|item| {
                Ok(RelatedLocation {
                    origin: self.locate(&item.pointer)?,
                    message: item.message.clone(),
                })
            })
            .collect::<Result<Vec<_>, InternalError>>()?;
        let origin = self.locate(&problem.pointer)?;

        self.context.report(Diagnostic {
            severity,
            rule: problem.rule.rule_id(),
            message: problem.message,
            fix: problem.fix,
            origin,
            related,
        });

        Ok(())
    }

    /// Reports one error.
    ///
    /// # Errors
    ///
    /// An internal error when a pointer of the problem has no authored origin.
    pub(crate) fn error(&mut self, problem: DeriveWireProblem) -> Result<(), InternalError> {
        self.report(Severity::Error, problem)
    }

    /// Reports one warning.
    ///
    /// # Errors
    ///
    /// An internal error when a pointer of the problem has no authored origin.
    pub(crate) fn warning(&mut self, problem: DeriveWireProblem) -> Result<(), InternalError> {
        self.report(Severity::Warning, problem)
    }
}

/// The reporter of a context.
pub(crate) const fn derive_wire_reporter<'half, 'run>(
    context: &'half mut HalfContext<'run>,
) -> DeriveWireReporter<'half, 'run> {
    DeriveWireReporter { context }
}
