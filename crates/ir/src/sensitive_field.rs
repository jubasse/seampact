//! Where the responses of an operation carry a sensitive value (ADR 0003 section 6).
//!
//! A property marked `sensitive`, or a scalar use marked `sensitive`, is reached from a body through
//! array items, JSON content, object properties, map keys and values and union variants, from a
//! response header's type, or from the params schema of an error code. Each schema is walked once
//! per holder place, so a recursive schema ends. An unknown use or schema kind is skipped.

use std::collections::HashSet;
use std::fmt;

use crate::{IrMap, Property, Response, Schema, SchemaId, TypeUse};

/// A referenced schema that the schema map lacks.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the schema '{schema}' is not in the schema map")]
pub struct MissingSchemaError {
    /// The id of the missing schema.
    pub schema: SchemaId,
}

/// A sensitive value a response carries.
///
/// `response` is the index of the response in the operation's responses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrSensitiveReach {
    /// Under a property of a body: the property, or a sensitive value at any depth of its type but
    /// a map key.
    Field {
        /// The index of the response.
        response: usize,
        /// The object schema that holds the property.
        schema: SchemaId,
        /// The property name.
        property: String,
    },
    /// Outside any property: a whole scalar body or its items.
    Body {
        /// The index of the response.
        response: usize,
    },
    /// The keys of a map schema.
    MapKey {
        /// The index of the response.
        response: usize,
        /// The map schema.
        schema: SchemaId,
    },
    /// A response header's type.
    Header {
        /// The index of the response.
        response: usize,
        /// The header name.
        header: String,
    },
}

/// What holds the value being walked, which is also where a sensitive value below it is reported.
#[derive(Debug, Clone)]
enum Holder {
    Field {
        response: usize,
        schema: SchemaId,
        property: String,
    },
    Body {
        response: usize,
    },
    Header {
        response: usize,
        header: String,
    },
}

/// The kind of a holder, which keys the visited set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum HolderPlace {
    Field,
    Body,
    Header,
}

impl Holder {
    fn place(&self) -> HolderPlace {
        match self {
            Self::Field { .. } => HolderPlace::Field,
            Self::Body { .. } => HolderPlace::Body,
            Self::Header { .. } => HolderPlace::Header,
        }
    }

    fn response(&self) -> usize {
        match self {
            Self::Field { response, .. }
            | Self::Body { response }
            | Self::Header { response, .. } => *response,
        }
    }

    fn to_reach(&self) -> IrSensitiveReach {
        match self {
            Self::Field {
                response,
                schema,
                property,
            } => IrSensitiveReach::Field {
                response: *response,
                schema: schema.clone(),
                property: property.clone(),
            },
            Self::Body { response } => IrSensitiveReach::Body {
                response: *response,
            },
            Self::Header { response, header } => IrSensitiveReach::Header {
                response: *response,
                header: header.clone(),
            },
        }
    }
}

struct Walk<'ir> {
    schemas: &'ir IrMap<SchemaId, Schema>,
    visited: HashSet<(HolderPlace, SchemaId)>,
    reaches: Vec<IrSensitiveReach>,
}

/// Every sensitive value the responses carry, in response order, each body before its headers.
///
/// # Errors
///
/// [`MissingSchemaError`] for the first referenced schema that `schemas` lacks.
pub fn find_ir_sensitive_reaches(
    responses: &[Response],
    schemas: &IrMap<SchemaId, Schema>,
) -> Result<Vec<IrSensitiveReach>, MissingSchemaError> {
    let mut walk = Walk {
        schemas,
        visited: HashSet::new(),
        reaches: Vec::new(),
    };

    for (index, response) in responses.iter().enumerate() {
        if let Some(body) = &response.body {
            walk_use(body, &Holder::Body { response: index }, &mut walk)?;
        }

        for header in &response.headers {
            let holder = Holder::Header {
                response: index,
                header: header.name.clone(),
            };

            walk_use(&header.r#type, &holder, &mut walk)?;
        }
    }

    Ok(walk.reaches)
}

/// Every sensitive value the params schema of an error code carries, walked as the body of one
/// response: each reach has `response` 0, and is a `Field` or a `MapKey` (params is an object
/// schema).
///
/// # Errors
///
/// [`MissingSchemaError`] for the first referenced schema that `schemas` lacks.
pub fn find_ir_sensitive_param_reaches(
    params: &SchemaId,
    schemas: &IrMap<SchemaId, Schema>,
) -> Result<Vec<IrSensitiveReach>, MissingSchemaError> {
    let mut walk = Walk {
        schemas,
        visited: HashSet::new(),
        reaches: Vec::new(),
    };

    walk_schema(params, &Holder::Body { response: 0 }, &mut walk)?;

    Ok(walk.reaches)
}

fn walk_use(
    type_use: &TypeUse,
    holder: &Holder,
    walk: &mut Walk<'_>,
) -> Result<(), MissingSchemaError> {
    match type_use {
        TypeUse::Array(array) => walk_use(&array.items, holder, walk),
        TypeUse::Scalar(scalar) => {
            if scalar.sensitive == Some(true) {
                walk.reaches.push(holder.to_reach());
            }

            match &scalar.content {
                Some(content) => walk_use(&content.schema, holder, walk),
                None => Ok(()),
            }
        }
        TypeUse::Ref(reference) => walk_schema(&reference.schema, holder, walk),
        _ => Ok(()),
    }
}

fn walk_schema(
    id: &SchemaId,
    holder: &Holder,
    walk: &mut Walk<'_>,
) -> Result<(), MissingSchemaError> {
    let visit = (holder.place(), id.clone());

    if walk.visited.contains(&visit) {
        return Ok(());
    }

    let schemas = walk.schemas;
    let Some(schema) = schemas.get(id) else {
        return Err(MissingSchemaError { schema: id.clone() });
    };

    walk.visited.insert(visit);

    match schema {
        Schema::Object(object) => walk_properties(id, &object.properties, holder, walk),
        Schema::Map(map) => {
            if let Some(TypeUse::Scalar(keys)) = &map.keys
                && keys.sensitive == Some(true)
            {
                walk.reaches.push(IrSensitiveReach::MapKey {
                    response: holder.response(),
                    schema: id.clone(),
                });
            }

            walk_use(&map.values, holder, walk)
        }
        Schema::Union(union) => {
            for variant in &union.variants {
                walk_schema(&variant.schema, holder, walk)?;
            }

            Ok(())
        }
        Schema::Unknown(_) => Ok(()),
    }
}

fn walk_properties(
    id: &SchemaId,
    properties: &[Property],
    holder: &Holder,
    walk: &mut Walk<'_>,
) -> Result<(), MissingSchemaError> {
    for property in properties {
        // A header keeps its own name as the holder: the header is what carries the value.
        let field = match holder {
            Holder::Header { .. } => holder.clone(),
            _ => Holder::Field {
                response: holder.response(),
                schema: id.clone(),
                property: property.name.clone(),
            },
        };

        if property.sensitive {
            walk.reaches.push(field.to_reach());

            continue;
        }

        walk_use(&property.r#type, &field, walk)?;
    }

    Ok(())
}

// The phrase `sensitive_reach_text` returns.
impl fmt::Display for IrSensitiveReach {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Field {
                schema, property, ..
            } => write!(
                formatter,
                "the sensitive property '{property}' of '{schema}'"
            ),
            Self::Body { response } => write!(
                formatter,
                "a sensitive value outside any property of its body (response {response})"
            ),
            Self::MapKey { schema, .. } => {
                write!(formatter, "the sensitive keys of '{schema}'")
            }
            Self::Header { header, .. } => write!(formatter, "the sensitive header '{header}'"),
        }
    }
}

/// The reach as a phrase for a message: what is sensitive and where.
#[must_use]
pub fn sensitive_reach_text(reach: &IrSensitiveReach) -> String {
    reach.to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    type TestResult = Result<(), serde_json::Error>;

    const SECRET_USE: fn() -> Value =
        || json!({"kind": "scalar", "type": "string", "refinements": {}, "sensitive": true});
    const PLAIN_USE: fn() -> Value =
        || json!({"kind": "scalar", "type": "string", "refinements": {}});

    fn base(id: &str) -> Value {
        json!({
            "id": id,
            "name": {"segments": [id], "role": "schema"},
            "directions": ["output"],
            "examples": [],
            "docs": {},
            "extensions": {},
            "origin": {"layer": "api", "pointer": "/schemas"},
        })
    }

    fn with(mut schema: Value, members: Value) -> Value {
        if let (Some(target), Some(extra)) = (schema.as_object_mut(), members.as_object()) {
            target.extend(extra.clone());
        }

        schema
    }

    fn property(name: &str, sensitive: bool, type_use: Value) -> Value {
        json!({
            "name": name, "type": type_use, "optional": false, "nullable": false,
            "sensitive": sensitive, "deprecated": false, "docs": {}, "extensions": {},
            "origin": {"layer": "api", "pointer": "/schemas"},
        })
    }

    fn object(id: &str, properties: Vec<Value>) -> Value {
        with(
            base(id),
            json!({"kind": "object", "properties": properties}),
        )
    }

    fn map(id: &str, keys: Value, values: Value) -> Value {
        with(
            base(id),
            json!({"kind": "map", "keys": keys, "values": values}),
        )
    }

    fn union(id: &str, variants: &[&str]) -> Value {
        let variants: Vec<Value> = variants
            .iter()
            .map(|schema| json!({"tag": schema, "schema": schema}))
            .collect();

        with(
            base(id),
            json!({"kind": "union", "tag": {"in": "body", "property": "type"}, "variants": variants}),
        )
    }

    fn reference(id: &str) -> Value {
        json!({"kind": "ref", "schema": id})
    }

    fn schema_map(schemas: Vec<Value>) -> Result<IrMap<SchemaId, Schema>, serde_json::Error> {
        let mut entries = serde_json::Map::new();

        for schema in schemas {
            let id = schema
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();

            entries.insert(id, schema);
        }

        serde_json::from_value(Value::Object(entries))
    }

    fn response(body: Option<Value>, headers: Vec<Value>) -> Value {
        let mut value = json!({
            "status": 200, "shape": "item", "headers": headers,
        });

        if let (Some(target), Some(body)) = (value.as_object_mut(), body) {
            target.insert("body".to_owned(), body);
        }

        value
    }

    fn header(name: &str, type_use: Value) -> Value {
        json!({"name": name, "type": type_use, "required": false})
    }

    fn reaches(
        responses: Vec<Value>,
        schemas: Vec<Value>,
    ) -> Result<Result<Vec<IrSensitiveReach>, MissingSchemaError>, serde_json::Error> {
        let responses: Vec<Response> = serde_json::from_value(Value::Array(responses))?;

        Ok(find_ir_sensitive_reaches(&responses, &schema_map(schemas)?))
    }

    fn id(text: &str) -> Result<SchemaId, serde_json::Error> {
        serde_json::from_value(json!(text))
    }

    #[test]
    fn a_schema_reached_through_a_property_and_again_as_a_body_is_reported_for_each_response()
    -> TestResult {
        let schemas = vec![
            map("SecretKeys", SECRET_USE(), PLAIN_USE()),
            object(
                "Holder",
                vec![property("keys", false, reference("SecretKeys"))],
            ),
        ];
        let responses = vec![
            response(Some(reference("Holder")), vec![]),
            response(Some(reference("SecretKeys")), vec![]),
        ];

        assert_eq!(
            reaches(responses, schemas)?,
            Ok(vec![
                IrSensitiveReach::MapKey {
                    response: 0,
                    schema: id("SecretKeys")?
                },
                IrSensitiveReach::MapKey {
                    response: 1,
                    schema: id("SecretKeys")?
                },
            ])
        );

        Ok(())
    }

    #[test]
    fn a_sensitive_property_is_a_field_and_its_type_is_not_walked() -> TestResult {
        let schemas = vec![
            object("Inner", vec![property("deep", true, PLAIN_USE())]),
            object(
                "User",
                vec![
                    property("token", true, reference("Inner")),
                    property("name", false, PLAIN_USE()),
                ],
            ),
        ];

        assert_eq!(
            reaches(vec![response(Some(reference("User")), vec![])], schemas)?,
            Ok(vec![IrSensitiveReach::Field {
                response: 0,
                schema: id("User")?,
                property: "token".to_owned(),
            }])
        );

        Ok(())
    }

    #[test]
    fn a_sensitive_scalar_body_and_its_array_items_are_body_reaches() -> TestResult {
        let array = json!({"kind": "array", "items": SECRET_USE()});
        let responses = vec![
            response(Some(SECRET_USE()), vec![]),
            response(Some(array), vec![]),
            response(Some(PLAIN_USE()), vec![]),
            response(None, vec![]),
        ];

        assert_eq!(
            reaches(responses, vec![])?,
            Ok(vec![
                IrSensitiveReach::Body { response: 0 },
                IrSensitiveReach::Body { response: 1 },
            ])
        );

        Ok(())
    }

    #[test]
    fn json_content_is_walked() -> TestResult {
        let mut content = PLAIN_USE();

        if let Some(target) = content.as_object_mut() {
            target.insert(
                "content".to_owned(),
                json!({"media": "application/json", "schema": reference("Secret")}),
            );
        }

        let schemas = vec![object("Secret", vec![property("key", true, PLAIN_USE())])];

        assert_eq!(
            reaches(vec![response(Some(content), vec![])], schemas)?,
            Ok(vec![IrSensitiveReach::Field {
                response: 0,
                schema: id("Secret")?,
                property: "key".to_owned(),
            }])
        );

        Ok(())
    }

    #[test]
    fn a_header_keeps_its_own_name_for_a_sensitive_value_below_it() -> TestResult {
        let schemas = vec![object("Meta", vec![property("secret", true, PLAIN_USE())])];
        let headers = vec![
            header("X-Plain", PLAIN_USE()),
            header("X-Secret", SECRET_USE()),
            header("X-Meta", reference("Meta")),
        ];

        assert_eq!(
            reaches(vec![response(Some(SECRET_USE()), headers)], schemas)?,
            Ok(vec![
                IrSensitiveReach::Body { response: 0 },
                IrSensitiveReach::Header {
                    response: 0,
                    header: "X-Secret".to_owned()
                },
                IrSensitiveReach::Header {
                    response: 0,
                    header: "X-Meta".to_owned()
                },
            ])
        );

        Ok(())
    }

    #[test]
    fn a_recursive_schema_ends_and_is_walked_once_per_holder_place() -> TestResult {
        let schemas = vec![object(
            "Node",
            vec![
                property("next", false, reference("Node")),
                property("secret", true, PLAIN_USE()),
            ],
        )];

        // The body place and the field place each walk Node once.
        let reach = IrSensitiveReach::Field {
            response: 0,
            schema: id("Node")?,
            property: "secret".to_owned(),
        };

        assert_eq!(
            reaches(vec![response(Some(reference("Node")), vec![])], schemas)?,
            Ok(vec![reach.clone(), reach])
        );
        Ok(())
    }

    #[test]
    fn union_variants_are_walked_in_order() -> TestResult {
        let schemas = vec![
            union("Either", &["A", "B"]),
            object("A", vec![property("a", true, PLAIN_USE())]),
            object("B", vec![property("b", true, PLAIN_USE())]),
        ];
        let found = reaches(vec![response(Some(reference("Either")), vec![])], schemas)?;
        let properties: Vec<String> = found
            .unwrap_or_default()
            .iter()
            .filter_map(|reach| match reach {
                IrSensitiveReach::Field { property, .. } => Some(property.clone()),
                _ => None,
            })
            .collect();

        assert_eq!(properties, ["a", "b"]);

        Ok(())
    }

    #[test]
    fn a_map_reports_sensitive_keys_and_walks_its_values() -> TestResult {
        let schemas = vec![
            map("Tokens", SECRET_USE(), reference("Secret")),
            map("Plain", PLAIN_USE(), SECRET_USE()),
            object("Secret", vec![property("key", true, PLAIN_USE())]),
        ];

        assert_eq!(
            reaches(
                vec![
                    response(Some(reference("Tokens")), vec![]),
                    response(Some(reference("Plain")), vec![]),
                ],
                schemas
            )?,
            Ok(vec![
                IrSensitiveReach::MapKey {
                    response: 0,
                    schema: id("Tokens")?
                },
                IrSensitiveReach::Field {
                    response: 0,
                    schema: id("Secret")?,
                    property: "key".to_owned(),
                },
                IrSensitiveReach::Body { response: 1 },
            ])
        );

        Ok(())
    }

    #[test]
    fn a_missing_schema_stops_the_walk_with_its_id() -> TestResult {
        let schemas = vec![object(
            "Holder",
            vec![property("gone", false, reference("Gone"))],
        )];

        assert_eq!(
            reaches(vec![response(Some(reference("Holder")), vec![])], schemas)?,
            Err(MissingSchemaError {
                schema: id("Gone")?
            })
        );

        Ok(())
    }

    #[test]
    fn an_unknown_use_kind_is_skipped() -> TestResult {
        let unknown = json!({"kind": "future"});

        assert_eq!(
            reaches(vec![response(Some(unknown), vec![])], vec![])?,
            Ok(vec![])
        );

        Ok(())
    }

    #[test]
    fn param_reaches_walk_the_params_schema_as_response_zero() -> TestResult {
        let schemas = schema_map(vec![
            object("Params", vec![property("card", true, PLAIN_USE())]),
            map("Keyed", SECRET_USE(), PLAIN_USE()),
        ])?;

        assert_eq!(
            find_ir_sensitive_param_reaches(&id("Params")?, &schemas),
            Ok(vec![IrSensitiveReach::Field {
                response: 0,
                schema: id("Params")?,
                property: "card".to_owned(),
            }])
        );
        assert_eq!(
            find_ir_sensitive_param_reaches(&id("Keyed")?, &schemas),
            Ok(vec![IrSensitiveReach::MapKey {
                response: 0,
                schema: id("Keyed")?
            }])
        );
        assert_eq!(
            find_ir_sensitive_param_reaches(&id("Nope")?, &schemas),
            Err(MissingSchemaError {
                schema: id("Nope")?
            })
        );

        Ok(())
    }

    #[test]
    fn the_text_of_each_place() -> TestResult {
        assert_eq!(
            sensitive_reach_text(&IrSensitiveReach::Field {
                response: 0,
                schema: id("User")?,
                property: "token".to_owned(),
            }),
            "the sensitive property 'token' of 'User'"
        );
        assert_eq!(
            sensitive_reach_text(&IrSensitiveReach::Body { response: 2 }),
            "a sensitive value outside any property of its body (response 2)"
        );
        assert_eq!(
            sensitive_reach_text(&IrSensitiveReach::MapKey {
                response: 0,
                schema: id("Keys")?
            }),
            "the sensitive keys of 'Keys'"
        );
        assert_eq!(
            sensitive_reach_text(&IrSensitiveReach::Header {
                response: 0,
                header: "X-Secret".to_owned(),
            }),
            "the sensitive header 'X-Secret'"
        );

        Ok(())
    }
}
