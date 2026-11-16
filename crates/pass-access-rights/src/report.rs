//! The diagnostics of the half (ADR 0006 section 4): rule `seampact/access/<rule>`, located at a
//! pointer of the merged raw tree.

use std::collections::HashSet;

use seampact_diagnostics::{
    Diagnostic, DiagnosticOrigin, InternalError, RelatedLocation, RuleId, Severity,
};

use crate::schema_use::AccessRightsContext;

/// The rules the half reports, each `seampact/access/<rule>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum AccessRightsRule {
    RightName,
    RightPattern,
    RightSubject,
    ProofSchema,
    ProofName,
    ProofInput,
    SignedInput,
    ScopeWithin,
    BucketKey,
    BucketWindow,
    ScopeUnknown,
    ScopeTwice,
    ScopeNesting,
    RequirementEntry,
    RequirementTarget,
    RequirementParams,
    RequirementBucket,
    RequirementSubject,
    RequirementTwice,
    GuestRight,
    CallerRight,
    PackTemplate,
    PackRight,
    FieldRightTarget,
    FieldRightParams,
    FieldRightSubject,
    FieldRightRecursive,
    FieldRightConflict,
    FieldRightPosition,
    FieldRightLimit,
    SortKeyRight,
    FilteredBy,
}

impl AccessRightsRule {
    /// Every rule, in the order of `RULE_IDS`.
    #[cfg(test)]
    pub(crate) const ALL: &'static [Self] = &[
        Self::RightName,
        Self::RightPattern,
        Self::RightSubject,
        Self::ProofSchema,
        Self::ProofName,
        Self::ProofInput,
        Self::SignedInput,
        Self::ScopeWithin,
        Self::BucketKey,
        Self::BucketWindow,
        Self::ScopeUnknown,
        Self::ScopeTwice,
        Self::ScopeNesting,
        Self::RequirementEntry,
        Self::RequirementTarget,
        Self::RequirementParams,
        Self::RequirementBucket,
        Self::RequirementSubject,
        Self::RequirementTwice,
        Self::GuestRight,
        Self::CallerRight,
        Self::PackTemplate,
        Self::PackRight,
        Self::FieldRightTarget,
        Self::FieldRightParams,
        Self::FieldRightSubject,
        Self::FieldRightRecursive,
        Self::FieldRightConflict,
        Self::FieldRightPosition,
        Self::FieldRightLimit,
        Self::SortKeyRight,
        Self::FilteredBy,
    ];

    /// The rule id as `diagnostics.json` writes it.
    pub(crate) const fn rule_id(self) -> RuleId {
        RuleId::from_static(match self {
            Self::RightName => "seampact/access/right-name",
            Self::RightPattern => "seampact/access/right-pattern",
            Self::RightSubject => "seampact/access/right-subject",
            Self::ProofSchema => "seampact/access/proof-schema",
            Self::ProofName => "seampact/access/proof-name",
            Self::ProofInput => "seampact/access/proof-input",
            Self::SignedInput => "seampact/access/signed-input",
            Self::ScopeWithin => "seampact/access/scope-within",
            Self::BucketKey => "seampact/access/bucket-key",
            Self::BucketWindow => "seampact/access/bucket-window",
            Self::ScopeUnknown => "seampact/access/scope-unknown",
            Self::ScopeTwice => "seampact/access/scope-twice",
            Self::ScopeNesting => "seampact/access/scope-nesting",
            Self::RequirementEntry => "seampact/access/requirement-entry",
            Self::RequirementTarget => "seampact/access/requirement-target",
            Self::RequirementParams => "seampact/access/requirement-params",
            Self::RequirementBucket => "seampact/access/requirement-bucket",
            Self::RequirementSubject => "seampact/access/requirement-subject",
            Self::RequirementTwice => "seampact/access/requirement-twice",
            Self::GuestRight => "seampact/access/guest-right",
            Self::CallerRight => "seampact/access/caller-right",
            Self::PackTemplate => "seampact/access/pack-template",
            Self::PackRight => "seampact/access/pack-right",
            Self::FieldRightTarget => "seampact/access/field-right-target",
            Self::FieldRightParams => "seampact/access/field-right-params",
            Self::FieldRightSubject => "seampact/access/field-right-subject",
            Self::FieldRightRecursive => "seampact/access/field-right-recursive",
            Self::FieldRightConflict => "seampact/access/field-right-conflict",
            Self::FieldRightPosition => "seampact/access/field-right-position",
            Self::FieldRightLimit => "seampact/access/field-right-limit",
            Self::SortKeyRight => "seampact/access/sort-key-right",
            Self::FilteredBy => "seampact/access/filtered-by",
        })
    }
}

/// The other side of a conflict a problem names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsRelated {
    pub(crate) pointer: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsProblem {
    pub(crate) rule: AccessRightsRule,
    pub(crate) message: String,
    pub(crate) fix: String,
    /// The pointer of the merged raw tree the diagnostic is located at.
    pub(crate) pointer: String,
    /// Joins the once key, so problems of one rule at one pointer about different things are each
    /// reported.
    pub(crate) distinct_by: Option<String>,
    pub(crate) related: Vec<AccessRightsRelated>,
}

/// Counts the errors and queues each problem once per rule, pointer and `distinct_by`; the run
/// writes the queue to the sink with [`report_queued`].
#[derive(Debug)]
pub(crate) struct AccessRightsReporter {
    errors: usize,
    reported: HashSet<(AccessRightsRule, String, String)>,
    queued: Vec<AccessRightsProblem>,
}

impl AccessRightsReporter {
    /// The number of errors reported so far, so a builder knows whether its element had one.
    pub(crate) const fn errors(&self) -> usize {
        self.errors
    }

    pub(crate) fn error(&mut self, problem: AccessRightsProblem) {
        self.errors += 1;

        let key = (
            problem.rule,
            problem.pointer.clone(),
            problem.distinct_by.as_deref().unwrap_or("").to_owned(),
        );

        if self.reported.insert(key) {
            self.queued.push(problem);
        }
    }
}

/// Locates each queued problem at its pointer through the context and reports it.
///
/// # Errors
///
/// An [`InternalError`] for a pointer with no authored origin.
pub(crate) fn report_queued(
    reporter: AccessRightsReporter,
    context: &mut AccessRightsContext,
) -> Result<(), InternalError> {
    for problem in reporter.queued {
        let mut related = Vec::with_capacity(problem.related.len());

        for item in problem.related {
            related.push(RelatedLocation {
                origin: locate(context, &item.pointer)?,
                message: item.message,
            });
        }

        let origin = locate(context, &problem.pointer)?;

        context.context.report(Diagnostic {
            severity: Severity::Error,
            rule: problem.rule.rule_id(),
            message: problem.message,
            fix: problem.fix,
            origin,
            related,
        });
    }

    Ok(())
}

// Every pointer reported is one the half read from an authored layer, so it has an authored origin.
fn locate(context: &AccessRightsContext, pointer: &str) -> Result<DiagnosticOrigin, InternalError> {
    let Some(origin) = context.context.origin(pointer) else {
        return Err(InternalError::new(format!(
            "access.rights located a diagnostic at {pointer}, which has no origin"
        )));
    };

    DiagnosticOrigin::of(&origin).ok_or_else(|| {
        InternalError::new(format!(
            "access.rights located a diagnostic at {pointer}, whose origin is the core, not an authored layer"
        ))
    })
}

pub(crate) fn access_rights_reporter() -> AccessRightsReporter {
    AccessRightsReporter {
        errors: 0,
        reported: HashSet::new(),
        queued: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RULE_IDS;

    #[test]
    fn rule_ids_list_every_rule_in_order() {
        let from_rules: Vec<RuleId> = AccessRightsRule::ALL
            .iter()
            .map(|rule| rule.rule_id())
            .collect();

        assert_eq!(from_rules, RULE_IDS);
    }
}
