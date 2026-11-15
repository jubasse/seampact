//! The `rights`, `rules`, `scopes` and `buckets` catalogues (ADR 0002 section 9, ADR 0004
//! section 4). An entry with an error is left out, so a requirement naming it reports nothing more.

use std::collections::{HashMap, HashSet};

use regress::Regex;
use seampact_ir::{
    Bucket, BucketId, ProofPlacement, Right, RightId, RightSubject, Rule, RuleId, Scope, ScopeId,
};
use seampact_diagnostics::InternalError;
use seampact_ir::IrMap;
use seampact_json::{JsonObject, JsonValue, stringify_json};
use seampact_pipeline::{ConventionReading, PassError};

use crate::not_ported::not_ported_yet;
use crate::read::{
    access_rights_entries, access_rights_member, access_rights_object, access_rights_schema_name,
    access_rights_string,
};
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
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

/// Builds the four catalogues, reporting each declaration's errors.
///
/// # Errors
///
/// An internal error, or a [`PassError::NotPortedYet`] from a declaration builder.
pub(crate) fn access_rights_catalogues(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
) -> Result<AccessRightsCatalogues, PassError> {
    let merged = Some(&context.context.raw.merged);
    let scope_names = names_of(merged, "scopes");
    let right_pattern = right_pattern_of(context, reporter)?;
    let forbidden_code = forbidden_code_of(context)?;

    let mut rights = IrMap::new();
    let mut right_id_names = HashMap::new();

    for (id, declaration) in access_rights_entries(merged, "rights") {
        let declared = RightDeclaration {
            id: id.to_owned(),
            declaration,
            scope_names: &scope_names,
            right_pattern: right_pattern.as_ref(),
            forbidden_code: &forbidden_code,
        };
        let Some(right) = right_of(context, reporter, &declared)? else {
            continue;
        };

        rights.insert(RightId::new(id.to_owned()), right);

        let subject = access_rights_object(access_rights_member(Some(declaration), "subject"));

        if let Some(id_name) = access_rights_schema_name(access_rights_member(subject, "id"))? {
            right_id_names.insert(id.to_owned(), id_name);
        }
    }

    let mut rules = IrMap::new();

    for (id, declaration) in access_rights_entries(merged, "rules") {
        if let Some(rule) = rule_of(context, reporter, id, declaration)? {
            rules.insert(RuleId::new(id.to_owned()), rule);
        }
    }

    let mut scopes = IrMap::new();

    for (id, declaration) in access_rights_entries(merged, "scopes") {
        let declared = DeclarationWithScopes {
            id: id.to_owned(),
            declaration,
            scope_names: &scope_names,
        };

        if let Some(scope) = scope_of(context, reporter, &declared)? {
            scopes.insert(ScopeId::new(id.to_owned()), scope);
        }
    }

    let mut buckets = IrMap::new();

    for (id, declaration) in access_rights_entries(merged, "buckets") {
        if let Some(bucket) = bucket_of(context, reporter, id, declaration)? {
            buckets.insert(BucketId::new(id.to_owned()), bucket);
        }
    }

    Ok(AccessRightsCatalogues {
        rights,
        rules,
        scopes,
        buckets,
        right_id_names,
        forbidden_code,
        declared: AccessRightsDeclared {
            rights: names_of(merged, "rights"),
            rules: names_of(merged, "rules"),
            scopes: scope_names,
            buckets: names_of(merged, "buckets"),
        },
        right_pattern,
    })
}

// The keys of a catalogue member, refused entries included.
fn names_of(merged: Option<&JsonObject>, catalogue: &str) -> HashSet<String> {
    access_rights_object(access_rights_member(merged, catalogue))
        .map(|entries| entries.keys().cloned().collect())
        .unwrap_or_default()
}

// The role binding is a code, or `{ code, params }` (ADR 0002 section 11); the core binds every
// role by default.
pub(crate) fn forbidden_code_of(context: &AccessRightsContext) -> Result<String, InternalError> {
    let binding = context
        .context
        .conventions
        .get("errors.derived.forbidden")?
        .map(|reading| reading.value);
    let code = match binding {
        Some(JsonValue::String(code)) => Some(code.as_str()),
        other => access_rights_string(access_rights_object(other), "code"),
    };

    code.map(str::to_owned).ok_or_else(|| {
        let written = binding.map_or_else(|| "undefined".to_owned(), stringify_json);

        InternalError::new(format!(
            "conventions.errors.derived.forbidden binds no code: {written}"
        ))
    })
}

pub(crate) fn right_pattern_of(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
) -> Result<Option<AccessRightsRightPattern>, InternalError> {
    let Some(ConventionReading {
        value: JsonValue::String(written),
        ..
    }) = context.context.conventions.get("rights.pattern")?
    else {
        return Ok(None);
    };

    match Regex::with_flags(written, "u") {
        Ok(pattern) => Ok(Some(AccessRightsRightPattern {
            pattern,
            pointer: RIGHT_PATTERN_POINTER.to_owned(),
        })),
        Err(error) => {
            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::RightPattern,
                message: format!(
                    "conventions.rights.pattern '{written}' is no regular expression: SyntaxError: Invalid regular expression: /{written}/u: {error}"
                ),
                fix: "write a regular expression every right name must match".to_owned(),
                pointer: RIGHT_PATTERN_POINTER.to_owned(),
                distinct_by: None,
                related: Vec::new(),
            });

            Ok(None)
        }
    }
}

pub(crate) fn access_rights_right_errors(
    _declaration: Option<&JsonObject>,
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
