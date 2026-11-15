//! The diagnostics of the half: rule `seampact/access/<rule>`, located at a pointer of the merged
//! raw tree through the api's side table.

use std::collections::HashSet;

use seampact_authoring::RawApi;
use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};
use seampact_ir::Origin;
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{HalfContext, Inherited, ResolvedConventions};

/// The rules this half reports, each `seampact/access/<rule>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccessIdentityRule {
    SchemeMember,
    SchemeReference,
    SchemeKind,
    SignatureVerify,
    SignatureTemplate,
    SignatureTolerance,
    SignatureKey,
    IdentityMember,
    Principal,
    PrincipalField,
    HeaderDeclaration,
    HeaderUse,
    DenyByDefault,
    IdentityReference,
    OptionalIdentity,
    AccessSchemes,
    SignedAccess,
    SignatureKeySource,
    SchemeQueryField,
    CsrfHeader,
    ServiceIdentity,
    ServiceAccess,
    BindingSource,
    BindingConflict,
    PublicIdentity,
}

impl AccessIdentityRule {
    /// The rule as the diagnostic ids write it, after `seampact/access/`.
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::SchemeMember => "scheme-member",
            Self::SchemeReference => "scheme-reference",
            Self::SchemeKind => "scheme-kind",
            Self::SignatureVerify => "signature-verify",
            Self::SignatureTemplate => "signature-template",
            Self::SignatureTolerance => "signature-tolerance",
            Self::SignatureKey => "signature-key",
            Self::IdentityMember => "identity-member",
            Self::Principal => "principal",
            Self::PrincipalField => "principal-field",
            Self::HeaderDeclaration => "header-declaration",
            Self::HeaderUse => "header-use",
            Self::DenyByDefault => "deny-by-default",
            Self::IdentityReference => "identity-reference",
            Self::OptionalIdentity => "optional-identity",
            Self::AccessSchemes => "access-schemes",
            Self::SignedAccess => "signed-access",
            Self::SignatureKeySource => "signature-key-source",
            Self::SchemeQueryField => "scheme-query-field",
            Self::CsrfHeader => "csrf-header",
            Self::ServiceIdentity => "service-identity",
            Self::ServiceAccess => "service-access",
            Self::BindingSource => "binding-source",
            Self::BindingConflict => "binding-conflict",
            Self::PublicIdentity => "public-identity",
        }
    }
}

/// A second location of a problem.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessIdentityRelated {
    /// A pointer of the merged raw tree.
    pub(crate) pointer: String,
    pub(crate) message: String,
}

/// What a check found, before it is located and reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessIdentityProblem {
    pub(crate) rule: AccessIdentityRule,
    pub(crate) message: String,
    pub(crate) fix: String,
    /// The pointer of the merged raw tree the diagnostic is located at.
    pub(crate) pointer: String,
    pub(crate) related: Vec<AccessIdentityRelated>,
}

/// The message and fix a refusal adds to a problem it is reported with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessIdentityRefusal {
    pub(crate) message: String,
    pub(crate) fix: String,
}

/// Reports the half's errors through its context, each located at its pointer, and carries the
/// context's readers: the half reads nothing else of it.
pub(crate) struct AccessIdentityReporter<'half, 'run> {
    context: &'half mut HalfContext<'run>,
    errors: usize,
}

impl<'run> AccessIdentityReporter<'_, 'run> {
    /// The number of errors reported so far.
    pub(crate) const fn errors(&self) -> usize {
        self.errors
    }

    pub(crate) fn raw(&self) -> &'run RawApi {
        self.context.raw
    }

    pub(crate) fn inherited(&self) -> &'run Inherited<'run> {
        self.context.inherited
    }

    pub(crate) fn conventions(&self) -> &'run ResolvedConventions<'run> {
        self.context.conventions
    }

    pub(crate) fn origin(&self, pointer: &str) -> Option<Origin> {
        self.context.origin(pointer)
    }

    // Every pointer reported is one the half read from the raw tree, so it always has an origin.
    fn locate(&self, pointer: &str) -> Result<DiagnosticOrigin, InternalError> {
        let located = self
            .context
            .origin(pointer)
            .and_then(|origin| DiagnosticOrigin::of(&origin));

        located.ok_or_else(|| {
            InternalError::new(format!(
                "access.identity located a diagnostic at {pointer}, which has no origin"
            ))
        })
    }

    /// Reports one error.
    ///
    /// # Errors
    ///
    /// An internal error when a pointer of the problem has no origin.
    pub(crate) fn error(&mut self, problem: AccessIdentityProblem) -> Result<(), InternalError> {
        self.errors += 1;

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
            rule: RuleId::new(format!("seampact/access/{}", problem.rule.as_str())),
            message: problem.message,
            fix: problem.fix,
            origin,
            related,
        });

        Ok(())
    }
}

/// The reporter of one run, counting from zero.
pub(crate) const fn access_identity_reporter<'half, 'run>(
    context: &'half mut HalfContext<'run>,
) -> AccessIdentityReporter<'half, 'run> {
    AccessIdentityReporter { context, errors: 0 }
}

/// A reporter that reports a problem once: a setting written on a node reaches every route below
/// it, so a problem that does not name the route would repeat. The wrapped reporter counts what
/// reaches it.
pub(crate) struct AccessIdentityOnceReporter<'once, 'half, 'run> {
    outer: &'once mut AccessIdentityReporter<'half, 'run>,
    reported: HashSet<String>,
}

impl<'run> AccessIdentityOnceReporter<'_, '_, 'run> {
    pub(crate) fn raw(&self) -> &'run RawApi {
        self.outer.raw()
    }

    pub(crate) fn inherited(&self) -> &'run Inherited<'run> {
        self.outer.inherited()
    }

    pub(crate) fn conventions(&self) -> &'run ResolvedConventions<'run> {
        self.outer.conventions()
    }

    pub(crate) fn origin(&self, pointer: &str) -> Option<Origin> {
        self.outer.origin(pointer)
    }

    /// Reports one error unless the same problem was reported before.
    ///
    /// # Errors
    ///
    /// An internal error when a pointer of the problem has no origin.
    pub(crate) fn error(&mut self, problem: AccessIdentityProblem) -> Result<(), InternalError> {
        let key = stringify_json(&JsonValue::Array(vec![
            JsonValue::String(problem.rule.as_str().to_owned()),
            JsonValue::String(problem.pointer.clone()),
            JsonValue::String(problem.message.clone()),
        ]));

        if !self.reported.insert(key) {
            return Ok(());
        }

        self.outer.error(problem)
    }
}

/// The once reporter over a reporter, counting from zero.
pub(crate) fn access_identity_once_reporter<'once, 'half, 'run>(
    reporter: &'once mut AccessIdentityReporter<'half, 'run>,
) -> AccessIdentityOnceReporter<'once, 'half, 'run> {
    AccessIdentityOnceReporter {
        outer: reporter,
        reported: HashSet::new(),
    }
}
