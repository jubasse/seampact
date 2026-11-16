//! The subject of a requirement: the value its right or rule is checked on (ADR 0002 section 9).

use indexmap::IndexSet;
use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    Direction, IrMap, KnownRightSubjectRef, KnownSchemaRef, KnownTypeUseRef, Layer, OperationScope,
    Property, RequirementSubject, ResourceSubject, Right, Schema, SchemaId, TypeUse, ValueSource,
    ValueSourceIn,
};
use seampact_json::JsonValue;
use seampact_pipeline::{
    OrderedSetting, PassError, TreeNodeId, TreeNodeKind, TreeNodes, pointer_below,
};

use crate::read::{
    access_rights_member, access_rights_merged_at, access_rights_object, access_rights_schema_name,
};
use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::routes::{AccessRightsAccessKind, AccessRightsRoute};
use crate::schema_use::{AccessRightsContext, access_rights_type_use};
use crate::source::{access_rights_source_text, access_rights_value_source};

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
            Ok(scope_subject(reporter, input, subject.scope.as_str()))
        }
        KnownRightSubjectRef::Resource(subject) => {
            resource_subject(context, reporter, input, subject)
        }
    }
}

fn subject_error(
    reporter: &mut AccessRightsReporter,
    message: String,
    fix: String,
    pointer: &str,
) -> AccessRightsSubjectResult<RequirementSubject> {
    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::RequirementSubject,
        message,
        fix,
        pointer: pointer.to_owned(),
        distinct_by: None,
        related: Vec::new(),
    });

    AccessRightsSubjectResult::Refused
}

pub(crate) fn scope_subject(
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsSubjectInput<'_>,
    scope: &str,
) -> AccessRightsSubjectResult<RequirementSubject> {
    let AccessRightsSubjectInput {
        route,
        right,
        scopes,
        scope_refused,
        written,
        use_pointer,
        ..
    } = input;

    if *scope_refused {
        return AccessRightsSubjectResult::Refused;
    }

    if !scopes
        .iter()
        .any(|resolved| resolved.scope.as_str() == scope)
    {
        return subject_error(
            reporter,
            format!(
                "right '{}' is checked against scope '{scope}', which route '{}' does not resolve",
                right.id, route.id
            ),
            format!(
                "enter scope '{scope}' on the route or an ancestor, or require the right elsewhere"
            ),
            use_pointer,
        );
    }

    let source = ValueSource {
        r#in: ValueSourceIn::Scope,
        name: Some(scope.to_owned()),
        prefix_bits: None,
    };
    let Some(written) = written else {
        return AccessRightsSubjectResult::Resolved {
            subject: Some(RequirementSubject {
                source,
                defaulted: true,
            }),
        };
    };

    if written.text == access_rights_source_text(&source) {
        return AccessRightsSubjectResult::Resolved {
            subject: Some(RequirementSubject {
                source,
                defaulted: false,
            }),
        };
    }

    subject_error(
        reporter,
        format!(
            "right '{}' takes the route's scope '{scope}' as its subject, not {}",
            right.id,
            access_rights_quoted(&written.text)
        ),
        format!("remove 'subject', or write 'scope.{scope}'"),
        &written.pointer,
    )
}

pub(crate) fn resource_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsSubjectInput<'_>,
    subject: &ResourceSubject,
) -> Result<AccessRightsSubjectResult<RequirementSubject>, PassError> {
    let AccessRightsSubjectInput {
        route,
        right,
        id_name,
        written,
        ..
    } = input;
    let expected = AccessRightsSourceSchema {
        type_use: subject.id_schema.clone(),
        name: id_name.clone(),
        optional: false,
    };
    let Some(written) = written else {
        return defaulted_subject(context, reporter, input, &expected);
    };
    let quoted = access_rights_quoted(&written.text);
    let source = access_rights_value_source(&written.text)?;

    if let Some(read) = &source
        && read.r#in == ValueSourceIn::Principal
        && route.access != AccessRightsAccessKind::Identity
    {
        let kind = match route.access {
            AccessRightsAccessKind::Public => "public",
            AccessRightsAccessKind::Optional | AccessRightsAccessKind::Identity => "optional-auth",
        };

        return Ok(subject_error(
            reporter,
            format!(
                "the subject {quoted} of right '{}' reads the principal, which is null for an anonymous caller of {kind} route '{}'",
                right.id, route.id
            ),
            "read the subject from a request value, or require the right on an identified route"
                .to_owned(),
            &written.pointer,
        ));
    }

    let found = match &source {
        Some(read) => source_schema(context, input, read)?,
        None => None,
    };
    let (Some(source), Some(found)) = (source, found) else {
        return Ok(subject_error(
            reporter,
            format!(
                "the subject {quoted} of right '{}' names nothing route '{}' reads",
                right.id, route.id
            ),
            "read the subject from a parameter, header, principal field or scope of the route"
                .to_owned(),
            &written.pointer,
        ));
    };

    if found.optional {
        return Ok(subject_error(
            reporter,
            format!(
                "the subject {quoted} of right '{}' is an optional field, which a caller of route '{}' may omit; the subject must be a required field",
                right.id, route.id
            ),
            "make the field required, or read the subject from a required one".to_owned(),
            &written.pointer,
        ));
    }

    if access_rights_same_schema(&found, &expected) {
        return Ok(AccessRightsSubjectResult::Resolved {
            subject: Some(RequirementSubject {
                source,
                defaulted: false,
            }),
        });
    }

    Ok(subject_error(
        reporter,
        format!(
            "the subject {quoted} of right '{}' is {}, not the right's id schema {}",
            right.id,
            describe(&found)?,
            describe(&expected)?
        ),
        "read the subject from a source whose schema is the right's id schema".to_owned(),
        &written.pointer,
    ))
}

pub(crate) fn defaulted_subject(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    input: &AccessRightsSubjectInput<'_>,
    expected: &AccessRightsSourceSchema,
) -> Result<AccessRightsSubjectResult<RequirementSubject>, PassError> {
    let AccessRightsSubjectInput {
        route,
        right,
        use_pointer,
        ..
    } = input;

    match access_rights_default_member_id(context, route.node, expected)? {
        DefaultSubject::Found { source } => Ok(AccessRightsSubjectResult::Resolved {
            subject: Some(RequirementSubject {
                source,
                defaulted: true,
            }),
        }),
        DefaultSubject::Ambiguous { candidates } => {
            let names: Vec<String> = candidates
                .iter()
                .map(|candidate| format!("'{}'", candidate.name))
                .collect();

            reporter.error(AccessRightsProblem {
                rule: AccessRightsRule::RequirementSubject,
                message: format!(
                    "ambiguous default subject: right '{}' on route '{}' could read member id {}, each of its id schema",
                    right.id,
                    route.id,
                    names.join(" or ")
                ),
                fix: "write the requirement's 'subject', naming one of the member ids".to_owned(),
                pointer: use_pointer.clone(),
                distinct_by: None,
                related: candidates
                    .iter()
                    .map(|candidate| AccessRightsRelated {
                        pointer: candidate.pointer.clone(),
                        message: format!(
                            "member id '{}' has the right's id schema",
                            candidate.name
                        ),
                    })
                    .collect(),
            });

            Ok(AccessRightsSubjectResult::Refused)
        }
        DefaultSubject::None => Ok(subject_error(
            reporter,
            format!(
                "right '{}' needs a subject on route '{}', and no member id of the route has its id schema",
                right.id, route.id
            ),
            "write the requirement's 'subject', a source whose schema is the right's id schema"
                .to_owned(),
            use_pointer,
        )),
    }
}

/// Two schemas are equal when both name the same schema, or both are inline with the same shape;
/// a named schema never equals an inline one.
pub(crate) fn access_rights_same_schema(
    found: &AccessRightsSourceSchema,
    expected: &AccessRightsSourceSchema,
) -> bool {
    if found.name.is_some() || expected.name.is_some() {
        return found.name == expected.name;
    }

    // Typed IR values compare by member, as their canonical texts do.
    found.type_use == expected.type_use
}

pub(crate) fn describe(schema: &AccessRightsSourceSchema) -> Result<String, InternalError> {
    if let Some(name) = &schema.name {
        return Ok(format!("'{name}'"));
    }

    let kind = match KnownTypeUseRef::try_from(&schema.type_use)? {
        KnownTypeUseRef::Array(_) => "array",
        KnownTypeUseRef::Ref(_) => "ref",
        KnownTypeUseRef::Scalar(_) => "scalar",
        KnownTypeUseRef::Enum(_) => "enum",
        KnownTypeUseRef::File(_) => "file",
        KnownTypeUseRef::Opaque(_) => "opaque",
    };

    Ok(format!("an inline {kind} schema"))
}

/// The member ids of the collections whose member scope holds `node`, nearest first, each in
/// written order.
pub(crate) fn member_ids(
    nodes: &TreeNodes<'_>,
    node: TreeNodeId,
) -> Result<Vec<MemberId>, InternalError> {
    let mut ids = Vec::new();
    let mut at = Some(node);

    while let Some(current) = at {
        let at_node = nodes.get(current)?;

        at = at_node.parent;

        let Some(collection_id) = at_node.parent else {
            continue;
        };

        if at_node.kind != TreeNodeKind::Scope || at_node.name != "member" {
            continue;
        }

        let collection = nodes.get(collection_id)?;
        let written = access_rights_member(Some(collection.settings), "id");
        let Some(JsonValue::Object(written)) = written else {
            continue;
        };

        for name in written.keys() {
            ids.push(MemberId {
                name: name.clone(),
                pointer: pointer_below(&collection.pointer, &["id", name]),
                collection: collection_id,
            });
        }
    }

    Ok(ids)
}

// The nearest collection with a member id of the expected schema decides: one such id is the
// default, two or more are ambiguous.
pub(crate) fn access_rights_default_member_id(
    context: &AccessRightsContext,
    node: TreeNodeId,
    expected: &AccessRightsSourceSchema,
) -> Result<DefaultSubject, PassError> {
    let ids = member_ids(&context.nodes, node)?;
    let mut collections: IndexSet<TreeNodeId> = IndexSet::new();

    for id in &ids {
        collections.insert(id.collection);
    }

    for collection in collections {
        let mut fitting = Vec::new();

        for id in ids.iter().filter(|id| id.collection == collection) {
            if access_rights_same_schema(&position_schema(context, &id.pointer)?, expected) {
                fitting.push(id.clone());
            }
        }

        let [only, ..] = fitting.as_slice() else {
            continue;
        };

        if fitting.len() == 1 {
            return Ok(DefaultSubject::Found {
                source: ValueSource {
                    r#in: ValueSourceIn::Path,
                    name: Some(only.name.clone()),
                    prefix_bits: None,
                },
            });
        }

        return Ok(DefaultSubject::Ambiguous {
            candidates: fitting,
        });
    }

    Ok(DefaultSubject::None)
}

// The schema written at a raw position, compiled by the schema service.
pub(crate) fn position_schema(
    context: &AccessRightsContext,
    pointer: &str,
) -> Result<AccessRightsSourceSchema, PassError> {
    let type_use = access_rights_type_use(context, pointer, &Direction::Input)?;
    let written = access_rights_merged_at(&context.context.raw.merged, pointer);

    Ok(AccessRightsSourceSchema {
        type_use,
        name: access_rights_schema_name(written.as_ref()),
        optional: false,
    })
}

pub(crate) fn source_schema(
    context: &AccessRightsContext,
    input: &AccessRightsSubjectInput<'_>,
    source: &ValueSource,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    let name = source.name.as_deref().unwrap_or("");

    match &source.r#in {
        ValueSourceIn::Path => path_schema(context, input.route.node, name),
        ValueSourceIn::Query => fields_schema(
            context,
            input.route.node,
            AccessRightsFieldsSetting::Query,
            &|key| key == name,
        ),
        ValueSourceIn::Header => fields_schema(
            context,
            input.route.node,
            AccessRightsFieldsSetting::Headers,
            &|key| key.to_lowercase() == name.to_lowercase(),
        ),
        ValueSourceIn::Scope => {
            if input
                .scopes
                .iter()
                .any(|scope| scope.scope.as_str() == name)
            {
                let pointer = pointer_below("/scopes", &[name, "id"]);

                return Ok(Some(position_schema(context, &pointer)?));
            }

            Ok(None)
        }
        ValueSourceIn::Principal => principal_schema(context, input, name),
        ValueSourceIn::Body
        | ValueSourceIn::Host
        | ValueSourceIn::Subdomain
        | ValueSourceIn::Address
        | ValueSourceIn::Resolver
        | ValueSourceIn::HolderField
        | ValueSourceIn::Unknown(_) => Ok(None),
    }
}

// A path parameter: a member id, or a `pathParams` entry of the route or an ancestor, the nearest
// first.
pub(crate) fn path_schema(
    context: &AccessRightsContext,
    node: TreeNodeId,
    name: &str,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    let ids = member_ids(&context.nodes, node)?;
    let member_id = ids.iter().find(|id| id.name == name);
    let mut at = Some(node);

    while let Some(current) = at {
        if let Some(member_id) = member_id
            && current == member_id.collection
        {
            return Ok(Some(position_schema(context, &member_id.pointer)?));
        }

        let at_node = context.nodes.get(current)?;
        let declared =
            access_rights_object(access_rights_member(Some(at_node.settings), "pathParams"));

        if access_rights_member(declared, name).is_some() {
            let pointer = pointer_below(&at_node.pointer, &["pathParams", name]);

            return Ok(Some(position_schema(context, &pointer)?));
        }

        at = at_node.parent;
    }

    Ok(None)
}

const OPTIONAL_FIELD: &str = "?";

// A query field or request header the route declares, in a fields map of the route or an
// ancestor.
pub(crate) fn fields_schema(
    context: &AccessRightsContext,
    node: TreeNodeId,
    setting: AccessRightsFieldsSetting,
    matches: &dyn Fn(&str) -> bool,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    let (ordered, setting_name) = match setting {
        AccessRightsFieldsSetting::Query => (OrderedSetting::Query, "query"),
        AccessRightsFieldsSetting::Headers => (OrderedSetting::Headers, "headers"),
    };
    let entries = context
        .context
        .inherited
        .ordered(node, ordered)?
        .unwrap_or_default();

    for entry in entries.iter().rev() {
        let Some(key) = &entry.key else {
            continue;
        };
        let field = key.strip_suffix(OPTIONAL_FIELD);

        if !matches(field.unwrap_or(key)) {
            continue;
        }

        let entry_node = context.nodes.get(entry.node)?;
        let pointer = pointer_below(&entry_node.pointer, &[setting_name, key]);
        let mut schema = position_schema(context, &pointer)?;

        schema.optional = field.is_some();

        return Ok(Some(schema));
    }

    Ok(None)
}

// A principal field (`principal.userId`, `principal.profile.id`), through the object schemas of
// the principal.
pub(crate) fn principal_schema(
    context: &AccessRightsContext,
    input: &AccessRightsSubjectInput<'_>,
    path: &str,
) -> Result<Option<AccessRightsSourceSchema>, PassError> {
    let Some(route_identity) = &input.route.identity else {
        return Ok(None);
    };
    let merged = Some(&context.context.raw.merged);
    let identities = access_rights_object(access_rights_member(merged, "identities"));
    let identity = access_rights_object(access_rights_member(identities, route_identity.as_str()));
    let mut schema_id = access_rights_schema_name(access_rights_member(identity, "principal"));
    let mut found: Option<AccessRightsSourceSchema> = None;
    let mut optional = false;

    for field in path.split('.') {
        let Some(schema) = schema_id.as_deref().and_then(|id| input.schemas.get(id)) else {
            return Ok(None);
        };
        let KnownSchemaRef::Object(object) = KnownSchemaRef::try_from(schema)? else {
            return Ok(None);
        };
        let Some(property) = object
            .properties
            .iter()
            .find(|candidate| candidate.name == field)
        else {
            return Ok(None);
        };

        optional = optional || property.optional;
        found = Some(access_rights_property_schema(context, property));
        schema_id = match KnownTypeUseRef::try_from(&property.r#type)? {
            KnownTypeUseRef::Ref(reference) => Some(reference.schema.as_str().to_owned()),
            KnownTypeUseRef::Array(_)
            | KnownTypeUseRef::Scalar(_)
            | KnownTypeUseRef::Enum(_)
            | KnownTypeUseRef::File(_)
            | KnownTypeUseRef::Opaque(_) => None,
        };
    }

    Ok(found.map(|mut schema| {
        schema.optional = optional;
        schema
    }))
}

/// The schema of an object property: its type use, and the schema its written position names, if
/// any.
pub(crate) fn access_rights_property_schema(
    context: &AccessRightsContext,
    property: &Property,
) -> AccessRightsSourceSchema {
    let name = if property.origin.layer == Layer::Core {
        None
    } else {
        let written =
            access_rights_merged_at(&context.context.raw.merged, &property.origin.pointer);

        access_rights_schema_name(written.as_ref())
    };

    AccessRightsSourceSchema {
        type_use: property.r#type.clone(),
        name,
        optional: false,
    }
}
