//! The diagnostics of the half (ADR 0006 section 4): rule `seampact/derive/<rule>`, located at a
//! pointer of the merged raw tree through the api's side table, with `related` naming the other
//! side of a conflict. A core declaration has no location, so a problem about one is located at
//! the binding or the use that reads it.

use seampact_authoring::RawApi;
use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};
use seampact_ir::{ContractIr, Origin};
use seampact_pipeline::{DraftIr, HalfContext, Inherited, ResolvedConventions, pipeline_origin};

/// The rules this half reports, each `seampact/derive/<rule>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum DeriveErrorsRule {
    ErrorRedefined,
    ErrorUnknown,
    ErrorPattern,
    ErrorNature,
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "tree.schemas reports this rule; the half keeps the TypeScript union"
        )
    )]
    ErrorParams,
    ErrorExample,
    ErrorDefault,
    NatureBase,
    RoleCode,
    RoleDatum,
    RoleParam,
    RoleParamRequired,
    RoleParamType,
    RoleTemplate,
    RetryParam,
    RelayDeclaration,
    CacheSensitiveElsewhere,
}

impl DeriveErrorsRule {
    /// Every rule of the half, in the order of the TypeScript union.
    #[cfg(test)]
    pub(crate) const ALL: &'static [Self] = &[
        Self::ErrorRedefined,
        Self::ErrorUnknown,
        Self::ErrorPattern,
        Self::ErrorNature,
        Self::ErrorParams,
        Self::ErrorExample,
        Self::ErrorDefault,
        Self::NatureBase,
        Self::RoleCode,
        Self::RoleDatum,
        Self::RoleParam,
        Self::RoleParamRequired,
        Self::RoleParamType,
        Self::RoleTemplate,
        Self::RetryParam,
        Self::RelayDeclaration,
        Self::CacheSensitiveElsewhere,
    ];

    /// The rule id as `diagnostics.json` writes it.
    pub(crate) const fn rule_id(self) -> RuleId {
        RuleId::from_static(match self {
            Self::ErrorRedefined => "seampact/derive/error-redefined",
            Self::ErrorUnknown => "seampact/derive/error-unknown",
            Self::ErrorPattern => "seampact/derive/error-pattern",
            Self::ErrorNature => "seampact/derive/error-nature",
            Self::ErrorParams => "seampact/derive/error-params",
            Self::ErrorExample => "seampact/derive/error-example",
            Self::ErrorDefault => "seampact/derive/error-default",
            Self::NatureBase => "seampact/derive/nature-base",
            Self::RoleCode => "seampact/derive/role-code",
            Self::RoleDatum => "seampact/derive/role-datum",
            Self::RoleParam => "seampact/derive/role-param",
            Self::RoleParamRequired => "seampact/derive/role-param-required",
            Self::RoleParamType => "seampact/derive/role-param-type",
            Self::RoleTemplate => "seampact/derive/role-template",
            Self::RetryParam => "seampact/derive/retry-param",
            Self::RelayDeclaration => "seampact/derive/relay-declaration",
            Self::CacheSensitiveElsewhere => "seampact/derive/cache-sensitive-elsewhere",
        })
    }
}

/// A second location of a problem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveErrorsRelated {
    /// A pointer of the merged raw tree.
    pub(crate) pointer: String,
    pub(crate) message: String,
}

/// What a check found, before it is located and reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeriveErrorsProblem {
    pub(crate) rule: DeriveErrorsRule,
    pub(crate) message: String,
    pub(crate) fix: String,
    /// The pointer of the merged raw tree the diagnostic is located at.
    pub(crate) pointer: String,
    pub(crate) related: Vec<DeriveErrorsRelated>,
}

/// What the half reads of its context, copied out so a read does not hold the reporter.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsContext<'run> {
    pub(crate) raw: &'run RawApi,
    pub(crate) conventions: &'run ResolvedConventions<'run>,
    pub(crate) inherited: &'run Inherited<'run>,
}

impl DeriveErrorsContext<'_> {
    /// The origin of a node of the merged raw tree.
    pub(crate) fn origin(&self, pointer: &str) -> Option<Origin> {
        pipeline_origin(self.raw, pointer)
    }
}

/// Reports the half's errors through its context, each located at its pointer.
pub(crate) struct DeriveErrorsReporter<'half, 'run> {
    context: &'half mut HalfContext<'run>,
}

impl<'run> DeriveErrorsReporter<'_, 'run> {
    /// The readers of the context.
    pub(crate) fn context(&self) -> DeriveErrorsContext<'run> {
        DeriveErrorsContext {
            raw: self.context.raw,
            conventions: self.context.conventions,
            inherited: self.context.inherited,
        }
    }

    /// The derived draft of a workspace api that already ran.
    pub(crate) fn relayed(&self, api: &str) -> Option<&'run DraftIr> {
        self.context.relayed(api)
    }

    /// The IR of an imported api, in the open reader types.
    pub(crate) fn imported(&self, api: &str) -> Option<&'run ContractIr> {
        self.context.imported(api)
    }

    // Every pointer reported is one the half read from an authored layer, so it has an authored
    // origin.
    fn locate(&self, pointer: &str) -> Result<DiagnosticOrigin, InternalError> {
        let origin = self.context.origin(pointer).ok_or_else(|| {
            InternalError::new(format!(
                "derive.errors located a diagnostic at {pointer}, which has no origin"
            ))
        })?;

        DiagnosticOrigin::of(&origin).ok_or_else(|| {
            InternalError::new(format!(
                "derive.errors located a diagnostic at {pointer}, whose origin is the core, not an authored layer"
            ))
        })
    }

    /// Reports one error.
    ///
    /// # Errors
    ///
    /// An internal error when a pointer of the problem has no authored origin.
    pub(crate) fn error(&mut self, problem: DeriveErrorsProblem) -> Result<(), InternalError> {
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
            severity: Severity::Error,
            rule: problem.rule.rule_id(),
            message: problem.message,
            fix: problem.fix,
            origin,
            related,
        });

        Ok(())
    }
}

/// The reporter of one run.
pub(crate) const fn derive_errors_reporter<'half, 'run>(
    context: &'half mut HalfContext<'run>,
) -> DeriveErrorsReporter<'half, 'run> {
    DeriveErrorsReporter { context }
}
