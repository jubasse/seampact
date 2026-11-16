//! The fields of a schema graph a restriction reaches, and the positions that refuse them.

use std::collections::{HashMap, HashSet};

use seampact_diagnostics::{InternalError, access_rights_quoted};
use seampact_ir::{
    FieldRestriction, IrMap, KnownSchemaRef, KnownTypeUseRef, ObjectSchema, Property, Schema,
    SchemaId, TypeUse,
};
use seampact_pipeline::{PassError, pointer_below};

use crate::report::{
    AccessRightsProblem, AccessRightsRelated, AccessRightsReporter, AccessRightsRule,
};
use crate::restrictions::{AccessRightsRestrictionChecks, access_rights_restriction_origin};
use crate::routes::AccessRightsRoute;

pub(crate) type AccessRightsDraftSchemas = IrMap<SchemaId, Schema>;

/// The most restricted fields one operation reaches before its walk stops.
pub(crate) const FIELD_RIGHTS_PER_OPERATION_LIMIT: usize = 1000;

/// A restricted field found by a walk.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsRestrictedField<'draft> {
    pub(crate) schema: String,
    pub(crate) pointer: String,
    pub(crate) holder: &'draft ObjectSchema,
    pub(crate) restriction: &'draft FieldRestriction,
}

/// One walk over the schemas an operation reaches; `reached` counts the fields found.
#[derive(Debug)]
pub(crate) struct AccessRightsFieldWalk<'draft, 'walk> {
    pub(crate) reporter: &'walk mut AccessRightsReporter,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) checks: &'walk mut AccessRightsRestrictionChecks,
    pub(crate) route: &'walk AccessRightsRoute,
    pub(crate) reached: usize,
}

/// What a refusal of restrictions below a position needs of a walk: the reporter, the schemas and
/// the checks.
#[derive(Debug)]
pub(crate) struct AccessRightsPositionWalk<'draft, 'walk> {
    pub(crate) reporter: &'walk mut AccessRightsReporter,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) checks: &'walk mut AccessRightsRestrictionChecks,
}

/// Where a walk is: the root schema, the pointer prefix, the schemas on the path.
#[derive(Debug, Clone)]
pub(crate) struct WalkAt {
    pub(crate) root: String,
    pub(crate) prefix: String,
    pub(crate) path: Vec<String>,
}

/// A position that refuses a restriction: its text and, when authored, its pointer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsRefusedPosition {
    pub(crate) text: String,
    pub(crate) pointer: Option<String>,
}

pub(crate) const fn access_rights_field_walk_exceeded(
    walk: &AccessRightsFieldWalk<'_, '_>,
) -> bool {
    walk.reached > FIELD_RIGHTS_PER_OPERATION_LIMIT
}

/// The schemas from which a restricted field can be reached, through any reference or JSON
/// content.
///
/// # Errors
///
/// An internal error for a schema or type use of a kind this revision does not know.
pub(crate) fn access_rights_restriction_reaching(
    schemas: &AccessRightsDraftSchemas,
) -> Result<HashSet<String>, InternalError> {
    let mut referenced_by: HashMap<String, Vec<String>> = HashMap::new();
    let mut reaching = HashSet::new();
    let mut pending: Vec<String> = Vec::new();

    for (id, schema) in schemas {
        for target in schema_references(schema)? {
            referenced_by
                .entry(target)
                .or_default()
                .push(id.as_str().to_owned());
        }

        let KnownSchemaRef::Object(object) = KnownSchemaRef::try_from(schema)? else {
            continue;
        };

        if object
            .properties
            .iter()
            .any(|property| property.restricted_to.is_some())
        {
            reaching.insert(id.as_str().to_owned());
            pending.push(id.as_str().to_owned());
        }
    }

    while let Some(id) = pending.pop() {
        for referrer in referenced_by.get(&id).into_iter().flatten() {
            if reaching.insert(referrer.clone()) {
                pending.push(referrer.clone());
            }
        }
    }

    Ok(reaching)
}

pub(crate) fn schema_references(schema: &Schema) -> Result<Vec<String>, InternalError> {
    match KnownSchemaRef::try_from(schema)? {
        KnownSchemaRef::Object(object) => {
            let mut references = Vec::new();

            for property in &object.properties {
                references.extend(use_references(&property.r#type)?);
            }

            Ok(references)
        }
        KnownSchemaRef::Map(map) => use_references(&map.values),
        KnownSchemaRef::Union(union) => Ok(union
            .variants
            .iter()
            .map(|variant| variant.schema.as_str().to_owned())
            .collect()),
    }
}

pub(crate) fn use_references(type_use: &TypeUse) -> Result<Vec<String>, InternalError> {
    match KnownTypeUseRef::try_from(type_use)? {
        KnownTypeUseRef::Array(array) => use_references(&array.items),
        KnownTypeUseRef::Ref(reference) => Ok(vec![reference.schema.as_str().to_owned()]),
        KnownTypeUseRef::Scalar(scalar) => match &scalar.content {
            Some(content) => use_references(&content.schema),
            None => Ok(Vec::new()),
        },
        KnownTypeUseRef::Opaque(_) | KnownTypeUseRef::File(_) | KnownTypeUseRef::Enum(_) => {
            Ok(Vec::new())
        }
    }
}

/// The schema of an id; `tree.schemas` wrote every schema a use names.
///
/// # Errors
///
/// An internal error for an id no schema has.
pub(crate) fn schema_of<'draft>(
    schemas: &'draft AccessRightsDraftSchemas,
    id: &str,
) -> Result<&'draft Schema, InternalError> {
    schemas.get(id).ok_or_else(|| {
        InternalError::new(format!(
            "a type use references schema '{id}', which tree.schemas did not write"
        ))
    })
}

/// Calls `found` for each restricted field the use reaches. A body that is not a reference (an
/// array of them) is walked from each schema it reaches, its pointers relative to that schema,
/// since an entry names a schema.
pub(crate) fn access_rights_restricted_fields<'draft>(
    walk: &mut AccessRightsFieldWalk<'draft, '_>,
    type_use: &TypeUse,
    found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
) -> Result<(), PassError> {
    let reference = match KnownTypeUseRef::try_from(type_use)? {
        KnownTypeUseRef::Array(array) => {
            return access_rights_restricted_fields(walk, &array.items, found);
        }
        KnownTypeUseRef::Ref(reference) => reference,
        KnownTypeUseRef::Scalar(_)
        | KnownTypeUseRef::Enum(_)
        | KnownTypeUseRef::File(_)
        | KnownTypeUseRef::Opaque(_) => return Ok(()),
    };
    let id = reference.schema.as_str();

    if !walk.checks.reaching.contains(id) {
        return Ok(());
    }

    let at = WalkAt {
        root: id.to_owned(),
        prefix: String::new(),
        path: vec![id.to_owned()],
    };

    walk_schema(walk, &at, found, id)
}

pub(crate) fn walk_schema<'draft>(
    walk: &mut AccessRightsFieldWalk<'draft, '_>,
    at: &WalkAt,
    found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
    id: &str,
) -> Result<(), PassError> {
    let schemas: &'draft AccessRightsDraftSchemas = walk.schemas;

    match KnownSchemaRef::try_from(schema_of(schemas, id)?)? {
        KnownSchemaRef::Object(object) => {
            for property in &object.properties {
                if access_rights_field_walk_exceeded(walk) {
                    return Ok(());
                }

                let pointer = pointer_below(&at.prefix, &[&property.name]);

                if let Some(restriction) = &property.restricted_to {
                    walk.reached += 1;
                    found(AccessRightsRestrictedField {
                        schema: at.root.clone(),
                        pointer: pointer.clone(),
                        holder: object,
                        restriction,
                    });
                }

                let below = WalkAt {
                    prefix: pointer,
                    ..at.clone()
                };

                walk_use(walk, &below, found, &property.r#type)?;
            }

            Ok(())
        }
        KnownSchemaRef::Map(map) => {
            let below = WalkAt {
                prefix: pointer_below(&at.prefix, &["*"]),
                ..at.clone()
            };

            walk_use(walk, &below, found, &map.values)
        }
        KnownSchemaRef::Union(union) => {
            for variant in &union.variants {
                walk_reference(walk, at, found, variant.schema.as_str())?;
            }

            Ok(())
        }
    }
}

pub(crate) fn walk_use<'draft>(
    walk: &mut AccessRightsFieldWalk<'draft, '_>,
    at: &WalkAt,
    found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
    type_use: &TypeUse,
) -> Result<(), PassError> {
    match KnownTypeUseRef::try_from(type_use)? {
        KnownTypeUseRef::Array(array) => {
            let below = WalkAt {
                prefix: pointer_below(&at.prefix, &["*"]),
                ..at.clone()
            };

            walk_use(walk, &below, found, &array.items)
        }
        KnownTypeUseRef::Ref(reference) => {
            walk_reference(walk, at, found, reference.schema.as_str())
        }
        KnownTypeUseRef::Scalar(scalar) => {
            let Some(content) = &scalar.content else {
                return Ok(());
            };

            walk.reached += 1;

            let mut position_walk = AccessRightsPositionWalk {
                reporter: &mut *walk.reporter,
                schemas: walk.schemas,
                checks: &mut *walk.checks,
            };
            let position = AccessRightsRefusedPosition {
                text: format!(
                    "the JSON content of field '{}'",
                    access_rights_quoted(&format!("{}{}", at.root, at.prefix))
                ),
                pointer: None,
            };

            access_rights_refuse_restrictions_below(&mut position_walk, &content.schema, &position)
        }
        KnownTypeUseRef::Enum(_) | KnownTypeUseRef::File(_) | KnownTypeUseRef::Opaque(_) => Ok(()),
    }
}

pub(crate) fn walk_reference<'draft>(
    walk: &mut AccessRightsFieldWalk<'draft, '_>,
    at: &WalkAt,
    found: &mut dyn FnMut(AccessRightsRestrictedField<'draft>),
    id: &str,
) -> Result<(), PassError> {
    if !walk.checks.reaching.contains(id) {
        return Ok(());
    }

    if !at.path.iter().any(|schema| schema == id) {
        let mut path = at.path.clone();

        path.push(id.to_owned());

        let below = WalkAt { path, ..at.clone() };

        return walk_schema(walk, &below, found, id);
    }

    walk.reached += 1;

    if walk.checks.recursive.contains(id) {
        return Ok(());
    }

    walk.checks.recursive.insert(id.to_owned());

    let origin = schema_of(walk.schemas, id)?.origin()?;

    walk.reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::FieldRightRecursive,
        message: format!(
            "schema '{id}' holds a restricted field and references itself below '{}', so route '{}' would have field rights at pointers without end",
            access_rights_quoted(&format!("{}{}", at.root, at.prefix)),
            walk.route.id
        ),
        fix: "restrict the field in a schema that is not recursive, or end the recursion before it"
            .to_owned(),
        pointer: origin.pointer.clone(),
        distinct_by: None,
        related: Vec::new(),
    });

    Ok(())
}

/// Refuses every restricted field the use reaches, each at its written restriction, once per
/// schema.
pub(crate) fn access_rights_refuse_restrictions_below(
    walk: &mut AccessRightsPositionWalk<'_, '_>,
    type_use: &TypeUse,
    position: &AccessRightsRefusedPosition,
) -> Result<(), PassError> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut pending = use_references(type_use)?;

    while let Some(id) = pending.pop() {
        if seen.contains(&id) || !walk.checks.reaching.contains(&id) {
            continue;
        }

        seen.insert(id.clone());

        let schema = schema_of(walk.schemas, &id)?;

        pending.extend(schema_references(schema)?);

        let KnownSchemaRef::Object(object) = KnownSchemaRef::try_from(schema)? else {
            continue;
        };

        for property in &object.properties {
            if let Some(restriction) = &property.restricted_to {
                refuse_position(walk.reporter, &id, property, restriction, position)?;
            }
        }
    }

    Ok(())
}

pub(crate) fn refuse_position(
    reporter: &mut AccessRightsReporter,
    holder: &str,
    property: &Property,
    restriction: &FieldRestriction,
    position: &AccessRightsRefusedPosition,
) -> Result<(), InternalError> {
    let related = position
        .pointer
        .iter()
        .map(|pointer| AccessRightsRelated {
            pointer: pointer.clone(),
            message: "the position is written here".to_owned(),
        })
        .collect();

    reporter.error(AccessRightsProblem {
        rule: AccessRightsRule::FieldRightPosition,
        message: format!(
            "field '{}' is restricted to right '{}' and is reached from {}, where the IR lists no field right",
            access_rights_quoted(&format!("{holder}{}", pointer_below("", &[&property.name]))),
            access_rights_quoted(restriction.right.as_str()),
            position.text
        ),
        fix: "move the restricted field out of the schemas this position reaches, or remove its restrictedTo".to_owned(),
        pointer: access_rights_restriction_origin(restriction)?.pointer.clone(),
        distinct_by: None,
        related,
    });

    Ok(())
}
