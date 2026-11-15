//! The subject of a requirement: the value its right or rule is checked on (ADR 0002 section 9).

use seampact_diagnostics::access_rights_quoted;
use seampact_ir::{
    IrMap, KnownRightSubjectRef, OperationScope, Property, RequirementSubject, ResourceSubject,
    Right, Schema, SchemaId, TypeUse, ValueSource,
};
use seampact_pipeline::{PassError, TreeNodeId, TreeNodes};

use crate::not_ported::not_ported_yet;
use crate::report::{AccessRightsProblem, AccessRightsReporter, AccessRightsRule};
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;

/// What a subject builder answers: `Refused` after an error, else the subject, absent when the
/// right has none. One definition for requirement subjects and field right subjects.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AccessRightsSubjectResult<Subject> {
    Refused,
    Resolved { subject: Option<Subject> },
}

/// The schema of a value source, with the name it is declared under and whether it is optional.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsSourceSchema {
    pub(crate) type_use: TypeUse,
    pub(crate) name: Option<String>,
    pub(crate) optional: bool,
}

/// One id member of a collection a subject may default to.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MemberId {
    pub(crate) name: String,
    pub(crate) pointer: String,
    pub(crate) collection: TreeNodeId,
}

/// The subject text the author wrote, with its pointer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsWrittenSubject {
    pub(crate) text: String,
    pub(crate) pointer: String,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsSubjectInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    pub(crate) right: Right,
    pub(crate) id_name: Option<String>,
    pub(crate) scopes: Vec<OperationScope>,
    pub(crate) scope_refused: bool,
    pub(crate) schemas: &'draft IrMap<SchemaId, Schema>,
    pub(crate) written: Option<AccessRightsWrittenSubject>,
    pub(crate) use_pointer: String,
}

/// What the default subject of a route is: found, ambiguous or none.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DefaultSubject {
    Found { source: ValueSource },
    Ambiguous { candidates: Vec<MemberId> },
    None,
}

/// Which setting of a node `fieldsSchema` reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccessRightsFieldsSetting {
    Query,
    Headers,
}

pub(crate) fn access_rights_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsSubjectInput<'_>,
) -> Result<AccessRightsSubjectResult<RequirementSubject>, PassError> {
    match KnownRightSubjectRef::try_from(&input.right.subject)? {
        KnownRightSubjectRef::NoSubject(_) => {
            let Some(written) = &input.written else {
                return Ok(AccessRightsSubjectResult::Resolved { subject: None });
            };

            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::RequirementSubject,
                message: format!(
                    "right '{}' has no subject, but this requirement reads one from {}",
                    input.right.id,
                    access_rights_quoted(&written.text)
                ),
                fix: "remove 'subject', or declare a subject on the right".to_owned(),
                pointer: written.pointer.clone(),
                distinct_by: None,
                related: Vec::new(),
            });

            Ok(AccessRightsSubjectResult::Refused)
        }
        KnownRightSubjectRef::Scope(subject) => {
            scope_subject(reporter, input, subject.scope.as_str())
        }
        KnownRightSubjectRef::Resource(subject) => {
            resource_subject(context, reporter, input, subject)
        }
    }
}

pub(crate) fn scope_subject(
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsSubjectInput<'_>,
    _scope: &str,
) -> Result<AccessRightsSubjectResult<RequirementSubject>, PassError> {
    Err(not_ported_yet("scopeSubject"))
}

pub(crate) fn resource_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsSubjectInput<'_>,
    _subject: &ResourceSubject,
) -> Result<AccessRightsSubjectResult<RequirementSubject>, PassError> {
    Err(not_ported_yet("resourceSubject"))
}

pub(crate) fn defaulted_subject(
    _context: &AccessRightsContext,
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsSubjectInput<'_>,
    _expected: &AccessRightsSourceSchema,
) -> Result<AccessRightsSubjectResult<RequirementSubject>, PassError> {
    Err(not_ported_yet("defaultedSubject"))
}

pub(crate) fn access_rights_same_schema(
    _found: &AccessRightsSourceSchema,
    _expected: &AccessRightsSourceSchema,
) -> Result<bool, PassError> {
    Err(not_ported_yet("accessRightsSameSchema"))
}

pub(crate) fn describe(_schema: &AccessRightsSourceSchema) -> Result<String, PassError> {
    Err(not_ported_yet("describe"))
}

pub(crate) fn member_ids(
    _nodes: &TreeNodes<'_>,
    _node: TreeNodeId,
) -> Result<Vec<MemberId>, PassError> {
    Err(not_ported_yet("memberIds"))
}

pub(crate) fn access_rights_default_member_id(
    _context: &AccessRightsContext,
    _node: TreeNodeId,
    _expected: &AccessRightsSourceSchema,
) -> Result<DefaultSubject, PassError> {
    Err(not_ported_yet("accessRightsDefaultMemberId"))
}

pub(crate) fn position_schema(
    _context: &AccessRightsContext,
    _pointer: &str,
) -> Result<AccessRightsSourceSchema, PassError> {
    Err(not_ported_yet("positionSchema"))
}

pub(crate) fn source_schema(
    _context: &AccessRightsContext,
    _input: &AccessRightsSubjectInput<'_>,
    _source: &ValueSource,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    Err(not_ported_yet("sourceSchema"))
}

pub(crate) fn path_schema(
    _context: &AccessRightsContext,
    _node: TreeNodeId,
    _name: &str,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    Err(not_ported_yet("pathSchema"))
}

pub(crate) fn fields_schema(
    _context: &AccessRightsContext,
    _node: TreeNodeId,
    _setting: AccessRightsFieldsSetting,
    _matches: &dyn Fn(&str) -> bool,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    Err(not_ported_yet("fieldsSchema"))
}

pub(crate) fn principal_schema(
    _context: &AccessRightsContext,
    _input: &AccessRightsSubjectInput<'_>,
    _path: &str,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    Err(not_ported_yet("principalSchema"))
}

pub(crate) fn access_rights_property_schema(
    _context: &AccessRightsContext,
    _property: &Property,
) -> Result<AccessRightsSourceSchema, PassError> {
    Err(not_ported_yet("accessRightsPropertySchema"))
}
