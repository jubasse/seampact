//! The params a right or rule use gives, checked against the params schema the target declares.

use seampact_json::JsonValue;
use seampact_pipeline::{PassError, TreeSchemaExampleIssue};

use crate::not_ported::not_ported_yet;
use crate::report::{AccessRightsReporter, AccessRightsRule};
use crate::schema_use::AccessRightsContext;

/// What declares the params.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccessRightsParamsKind {
    Right,
    Rule,
}

/// One use of params; `rule` is `RequirementParams` or `FieldRightParams`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsParamsUse {
    pub(crate) rule: AccessRightsRule,
    pub(crate) kind: AccessRightsParamsKind,
    pub(crate) name: String,
    /// What gives them: `the requirement`.
    pub(crate) holder: String,
    /// The params schema the target declares, if any.
    pub(crate) schema: Option<String>,
    pub(crate) params: Option<JsonValue>,
    /// Where the params are written.
    pub(crate) params_pointer: String,
    /// Where the use is written, for params that are missing.
    pub(crate) use_pointer: String,
}

/// The params of a use that fit, `None` inside when none were written.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsCheckedParams {
    pub(crate) params: Option<JsonValue>,
}

const LISTED_ISSUES: usize = 3;

pub(crate) fn access_rights_check_params(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _use: &AccessRightsParamsUse,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    Err(not_ported_yet("accessRightsCheckParams"))
}

pub(crate) fn listed_issues(_issues: &[TreeSchemaExampleIssue]) -> Result<String, PassError> {
    Err(not_ported_yet("listedIssues"))
}
