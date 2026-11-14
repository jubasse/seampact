//! The `rights`, `rules`, `scopes` and `buckets` catalogues (ADR 0002 section 9, ADR 0004
//! section 4). An entry with an error is left out, so a requirement naming it reports nothing more.

use std::collections::{HashMap, HashSet};

use regress::Regex;
use seampact_ir::{
    Bucket, BucketId, ProofPlacement, Right, RightId, RightSubject, Rule, RuleId, Scope, ScopeId,
};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::report::AccessRightsReporter;
use crate::schema_use::AccessRightsContext;

/// The names declared in each catalogue, refused ones included, so a use of a refused one adds no
/// error. A pack-derived right that is refused adds its name too.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AccessRightsDeclared {
    pub(crate) rights: HashSet<String>,
    pub(crate) rules: HashSet<String>,
    pub(crate) scopes: HashSet<String>,
    pub(crate) buckets: HashSet<String>,
}

/// `conventions.rights.pattern`, compiled, with its pointer.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsRightPattern {
    pub(crate) pattern: Regex,
    pub(crate) pointer: String,
}

/// The catalogues the half builds, by id, before it writes them.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsCatalogues {
    pub(crate) rights: seampact_ir::IrMap<RightId, Right>,
    pub(crate) rules: seampact_ir::IrMap<RuleId, Rule>,
    pub(crate) scopes: seampact_ir::IrMap<ScopeId, Scope>,
    pub(crate) buckets: seampact_ir::IrMap<BucketId, Bucket>,
    /// The schema each resource right's id names (`TaskId`), when it names one; pack-derived
    /// rights add theirs.
    pub(crate) right_id_names: HashMap<String, String>,
    pub(crate) declared: AccessRightsDeclared,
    /// The code of the `forbidden` role, which a right without written `errors` answers.
    pub(crate) forbidden_code: String,
    /// `None` when the convention is not written.
    pub(crate) right_pattern: Option<AccessRightsRightPattern>,
}

/// What `accessRightsCheckName` reads of one right id.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsNameCheck<'pattern> {
    pub(crate) id: String,
    pub(crate) code_name: Option<String>,
    pub(crate) pointer: String,
    pub(crate) right_pattern: Option<&'pattern AccessRightsRightPattern>,
}

/// One right declaration with what its builder needs besides the context.
#[derive(Debug, Clone)]
pub(crate) struct RightDeclaration<'raw, 'pattern> {
    pub(crate) id: String,
    pub(crate) declaration: &'raw JsonObject,
    pub(crate) scope_names: &'pattern HashSet<String>,
    pub(crate) right_pattern: Option<&'pattern AccessRightsRightPattern>,
    pub(crate) forbidden_code: &'pattern str,
}

/// One scope or right declaration read with the scope names the api declares.
#[derive(Debug, Clone)]
pub(crate) struct DeclarationWithScopes<'raw, 'names> {
    pub(crate) id: String,
    pub(crate) declaration: &'raw JsonObject,
    pub(crate) scope_names: &'names HashSet<String>,
}

/// The largest prefix an address bucket key may count (an IPv6 address).
const ADDRESS_BITS: u32 = 128;

const RIGHT_PATTERN_POINTER: &str = "/conventions/rights/pattern";

const PROOF_PLACEMENTS: &[&str] = &["header", "body"];

const UNREADABLE_PROOF_KINDS: &[&str] = &["file", "opaque"];

pub(crate) fn access_rights_catalogues(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
) -> Result<AccessRightsCatalogues, PassError> {
    Err(not_ported_yet("accessRightsCatalogues"))
}

pub(crate) fn forbidden_code_of(_context: &AccessRightsContext) -> Result<String, PassError> {
    Err(not_ported_yet("forbiddenCodeOf"))
}

pub(crate) fn right_pattern_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
) -> Result<Option<AccessRightsRightPattern>, PassError> {
    Err(not_ported_yet("rightPatternOf"))
}

pub(crate) fn access_rights_right_errors(
    _declaration: Option<&JsonValue>,
    _forbidden_code: &str,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("accessRightsRightErrors"))
}

pub(crate) fn proof_placement(
    _placement: &str,
    _pointer: &str,
) -> Result<ProofPlacement, PassError> {
    Err(not_ported_yet("proofPlacement"))
}

pub(crate) fn scope_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _options: &DeclarationWithScopes<'_, '_>,
) -> Result<Option<Scope>, PassError> {
    Err(not_ported_yet("scopeOf"))
}

pub(crate) fn right_subject_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _options: &DeclarationWithScopes<'_, '_>,
) -> Result<Option<RightSubject>, PassError> {
    Err(not_ported_yet("rightSubjectOf"))
}

pub(crate) fn right_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _declaration: &RightDeclaration<'_, '_>,
) -> Result<Option<Right>, PassError> {
    Err(not_ported_yet("rightOf"))
}

pub(crate) fn access_rights_check_name(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _options: &AccessRightsNameCheck<'_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("accessRightsCheckName"))
}

pub(crate) fn bucket_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _id: &str,
    _declaration: &JsonObject,
) -> Result<Option<Bucket>, PassError> {
    Err(not_ported_yet("bucketOf"))
}

pub(crate) fn rule_of(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _id: &str,
    _declaration: &JsonObject,
) -> Result<Option<Rule>, PassError> {
    Err(not_ported_yet("ruleOf"))
}

pub(crate) fn within_of(
    _context: &AccessRightsContext,
    _scope: &str,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("withinOf"))
}

pub(crate) fn within_chain_terminates(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _id: &str,
    _scope_names: &HashSet<String>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("withinChainTerminates"))
}

pub(crate) fn report_within_cycle(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _cycle: &[String],
) -> Result<(), PassError> {
    Err(not_ported_yet("reportWithinCycle"))
}
