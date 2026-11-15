//! The params a right or rule use gives, checked against the params schema the target declares.

use seampact_diagnostics::access_rights_quoted;
use seampact_ir::{KnownTypeUse, RefTypeUse, SchemaId};
use seampact_json::{JsonObject, JsonValue};
use seampact_pipeline::{PassError, TreeSchemaExampleIssue};

use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
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

/// The params of a use, when they fit; `None` after an error.
pub(crate) fn access_rights_check_params(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    use_of: &AccessRightsParamsUse,
) -> Result<Option<AccessRightsCheckedParams>, PassError> {
    let kind = match use_of.kind {
        AccessRightsParamsKind::Right => "right",
        AccessRightsParamsKind::Rule => "rule",
    };
    let target = format!("{kind} '{}'", use_of.name);
    let holder = &use_of.holder;

    let Some(schema) = &use_of.schema else {
        if use_of.params.is_none() {
            return Ok(Some(AccessRightsCheckedParams { params: None }));
        }

        reporter.error(AccessRightsProblem {
            rule: use_of.rule,
            message: format!("{target} declares no params, but {holder} gives some"),
            fix: format!("remove 'params', or declare params on the {kind}"),
            pointer: use_of.params_pointer.clone(),
            distinct_by: None,
            related: Vec::new(),
        });

        return Ok(None);
    };

    let written = use_of
        .params
        .clone()
        .unwrap_or_else(|| JsonValue::Object(JsonObject::new()));
    let params_schema = KnownTypeUse::Ref(RefTypeUse {
        schema: SchemaId::new(schema.clone()),
        unknown_keys: None,
        nullable: None,
        docs: None,
        examples: None,
    })
    .into();
    let issues = context.schemas.check_example(&written, &params_schema)?;

    if issues.is_empty() {
        return Ok(Some(AccessRightsCheckedParams {
            params: use_of.params.clone(),
        }));
    }

    reporter.error(AccessRightsProblem {
        rule: use_of.rule,
        message: format!(
            "the params of {holder} do not fit {schema}, the params of {target}: {}",
            listed_issues(&issues)
        ),
        fix: format!("give params that fit {schema}"),
        pointer: if use_of.params.is_none() {
            use_of.use_pointer.clone()
        } else {
            use_of.params_pointer.clone()
        },
        distinct_by: None,
        related: Vec::new(),
    });

    Ok(None)
}

/// A message lists the first issues, each quoted, and counts the rest.
pub(crate) fn listed_issues(issues: &[TreeSchemaExampleIssue]) -> String {
    let listed: Vec<String> = issues
        .iter()
        .take(LISTED_ISSUES)
        .map(|issue| {
            let pointer = if issue.pointer.is_empty() {
                "(params)"
            } else {
                &issue.pointer
            };

            access_rights_quoted(&format!("{pointer}: {}", issue.message))
        })
        .collect();
    let more = issues.len().saturating_sub(listed.len());

    if more > 0 {
        format!("{}; and {more} more", listed.join("; "))
    } else {
        listed.join("; ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue(pointer: &str, message: &str) -> TreeSchemaExampleIssue {
        TreeSchemaExampleIssue {
            pointer: pointer.to_owned(),
            message: message.to_owned(),
        }
    }

    #[test]
    fn issues_list_the_first_three_and_count_the_rest() {
        let issues = [
            issue("", "is required"),
            issue("/a", "no"),
            issue("/b", "no"),
            issue("/c", "no"),
            issue("/d", "no"),
        ];

        assert_eq!(
            listed_issues(&issues),
            "(params): is required; /a: no; /b: no; and 2 more"
        );
        assert_eq!(listed_issues(&issues[..2]), "(params): is required; /a: no");
        assert_eq!(listed_issues(&[]), "");
    }
}
