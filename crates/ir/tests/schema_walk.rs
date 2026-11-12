//! The IR types match the IR JSON Schemas: the registries list every open enum and union, the
//! examples carry every member, a member is required in the types exactly when the schema says
//! so, and every integer member reads the schema's whole range.

use std::collections::{BTreeMap, BTreeSet};

use seampact_ir::{ContractIr, IR_SCHEMA_FILES, OPEN_ENUMS, SourceMap, UNIONS};
use seampact_json::escape_pointer;
use serde_json::Value;

/// The IR example that names every member of the IR schema.
const EVERY_MEMBER_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/every-member.ir.json");

/// The minimal IR example: its api version is the label variant.
const MINIMAL_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/minimal.ir.json");

/// The source-map example: it names every member of the source-map schema.
const SOURCE_MAP_EXAMPLE: &str =
    include_str!("../../../packages/core/spec/schemas/ir/examples/minimal.source-map.json");

/// The root definition of the IR document.
const IR_ROOT_DEFINITION: &str = "ContractIR";

/// The root definition of the source map.
const SOURCE_MAP_ROOT_DEFINITION: &str = "SourceMap";

/// The marker of an open enum definition.
const KNOWN_VALUES_KEYWORD: &str = "x-seampact-known";

/// The marker of a definition whose unknown values a reader must act on.
const MUST_ACT_KEYWORD: &str = "x-seampact-must-act";

/// Each open enum's known values and must-act flag, by definition name.
type OpenEnumRegistry = BTreeMap<String, (Vec<String>, bool)>;

/// Each union's tag member, known tags and must-act flag, by definition name.
type UnionRegistry = BTreeMap<String, (String, Vec<String>, bool)>;

/// Which typed root an example decodes into.
#[derive(Debug, Clone, Copy)]
enum Root {
    Ir,
    SourceMap,
}

impl Root {
    fn root_definition(self) -> &'static str {
        match self {
            Self::Ir => IR_ROOT_DEFINITION,
            Self::SourceMap => SOURCE_MAP_ROOT_DEFINITION,
        }
    }

    /// Decodes `document` into the typed root and encodes it back.
    fn rewrite(self, document: &Value) -> Result<Value, String> {
        let text = document.to_string();
        let rewritten = match self {
            Self::Ir => ContractIr::from_json_text(&text).and_then(|typed| {
                serde_json::to_value(typed).map_err(seampact_ir::IrError::Encode)
            }),
            Self::SourceMap => SourceMap::from_json_text(&text).and_then(|typed| {
                serde_json::to_value(typed).map_err(seampact_ir::IrError::Encode)
            }),
        };

        rewritten.map_err(|error| error.to_string())
    }
}

/// An example document and the root it decodes into.
struct Example {
    root: Root,
    text: &'static str,
}

/// The examples walked, every-member first: the first occurrence of a member wins.
const EXAMPLES: [Example; 3] = [
    Example {
        root: Root::Ir,
        text: EVERY_MEMBER_EXAMPLE,
    },
    Example {
        root: Root::Ir,
        text: MINIMAL_EXAMPLE,
    },
    Example {
        root: Root::SourceMap,
        text: SOURCE_MAP_EXAMPLE,
    },
];

/// Every definition of the IR schema files, by name; names are unique across the files.
struct Definitions(BTreeMap<String, Value>);

impl Definitions {
    fn load() -> Result<Self, String> {
        let mut definitions = BTreeMap::new();

        for file in IR_SCHEMA_FILES {
            let schema: Value = serde_json::from_str(file.text)
                .map_err(|error| format!("{}: {error}", file.name))?;
            let Some(file_definitions) = schema.get("$defs").and_then(Value::as_object) else {
                return Err(format!("{}: no $defs", file.name));
            };

            for (name, definition) in file_definitions {
                if definitions
                    .insert(name.clone(), definition.clone())
                    .is_some()
                {
                    return Err(format!(
                        "{}: the definition {name} is defined twice",
                        file.name
                    ));
                }
            }
        }

        Ok(Self(definitions))
    }

    fn get(&self, name: &str) -> Result<&Value, String> {
        self.0
            .get(name)
            .ok_or_else(|| format!("no definition {name}"))
    }

    /// The definition a `$ref` names: `#/$defs/<name>` or `<file>#/$defs/<name>`.
    fn referenced(&self, reference: &str) -> Result<(&str, &Value), String> {
        let name = reference
            .rsplit_once("#/$defs/")
            .map(|(_, name)| name)
            .ok_or_else(|| format!("unexpected $ref {reference}"))?;

        self.0
            .get_key_value(name)
            .map(|(name, definition)| (name.as_str(), definition))
            .ok_or_else(|| format!("no definition {name}"))
    }

    /// Every object definition and its members, required ones marked.
    fn object_members(&self) -> BTreeMap<(String, String), bool> {
        let mut members = BTreeMap::new();

        for (name, definition) in &self.0 {
            let Some(properties) = definition.get("properties").and_then(Value::as_object) else {
                continue;
            };

            for member in properties.keys() {
                let is_required = required_members(definition).contains(member.as_str());

                members.insert((name.clone(), member.clone()), is_required);
            }
        }

        members
    }
}

fn required_members(definition: &Value) -> BTreeSet<&str> {
    definition
        .get("required")
        .and_then(Value::as_array)
        .map(|required| required.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// One member of an object definition found in an example.
#[derive(Debug, Clone)]
struct MemberOccurrence {
    definition: String,
    member: String,
    parent_pointer: String,
    member_schema: Value,
    value: Value,
}

impl MemberOccurrence {
    fn pointer(&self) -> String {
        format!("{}/{}", self.parent_pointer, escape_pointer(&self.member))
    }
}

/// Walks `instance` with `schema`, the definition `definition` when the schema is one, and
/// records each member of an object definition it meets.
struct InstanceWalk<'walk> {
    definitions: &'walk Definitions,
    found: Vec<MemberOccurrence>,
}

impl InstanceWalk<'_> {
    fn walk(
        &mut self,
        schema: &Value,
        definition: Option<&str>,
        instance: &Value,
        pointer: &str,
    ) -> Result<(), String> {
        if let Some(reference) = schema.get("$ref").and_then(Value::as_str) {
            let (name, referenced) = self.definitions.referenced(reference)?;

            return self.walk(referenced, Some(name), instance, pointer);
        }

        if schema.get("oneOf").is_some() {
            return self.walk_union(schema, instance, pointer);
        }

        match instance {
            Value::Object(members) => self.walk_object(schema, definition, members, pointer),
            Value::Array(items) => {
                let Some(item_schema) = schema.get("items") else {
                    return Ok(());
                };

                for (index, item) in items.iter().enumerate() {
                    self.walk(item_schema, None, item, &format!("{pointer}/{index}"))?;
                }

                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// Walks the variant the tag names; an unknown tag has no schema to walk.
    fn walk_union(&mut self, union: &Value, instance: &Value, pointer: &str) -> Result<(), String> {
        let tag_member = union
            .pointer("/discriminator/propertyName")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{pointer}: a oneOf without a discriminator"))?;
        let tag = instance.get(tag_member);
        let variants = union
            .get("oneOf")
            .and_then(Value::as_array)
            .into_iter()
            .flatten();

        for variant in variants {
            let reference = variant
                .get("$ref")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (_, variant_definition) = self.definitions.referenced(reference)?;
            let variant_tag =
                variant_definition.pointer(&format!("/properties/{tag_member}/const"));

            if variant_tag.is_some() && variant_tag == tag {
                return self.walk(variant, None, instance, pointer);
            }
        }

        Ok(())
    }

    fn walk_object(
        &mut self,
        schema: &Value,
        definition: Option<&str>,
        members: &serde_json::Map<String, Value>,
        pointer: &str,
    ) -> Result<(), String> {
        let properties = schema.get("properties").and_then(Value::as_object);
        let additional_properties = schema
            .get("additionalProperties")
            .filter(|node| node.is_object());

        for (key, value) in members {
            let member_pointer = format!("{pointer}/{}", escape_pointer(key));

            if let Some(member_schema) = properties.and_then(|properties| properties.get(key)) {
                let definition =
                    definition.ok_or_else(|| format!("{pointer}: an inline object"))?;

                self.found.push(MemberOccurrence {
                    definition: definition.to_owned(),
                    member: key.clone(),
                    parent_pointer: pointer.to_owned(),
                    member_schema: member_schema.clone(),
                    value: value.clone(),
                });
                self.walk(member_schema, None, value, &member_pointer)?;
            } else if let Some(value_schema) = additional_properties {
                self.walk(value_schema, None, value, &member_pointer)?;
            }
        }

        Ok(())
    }
}

/// The members of an object definition, by definition and member name.
type MemberOccurrences = BTreeMap<(String, String), MemberOccurrence>;

/// Each example with the members first found in it, in [`EXAMPLES`] order.
fn examples_with_first_occurrences(
    definitions: &Definitions,
) -> Result<Vec<(Root, Value, MemberOccurrences)>, String> {
    let mut seen_members = BTreeSet::new();
    let mut examples = Vec::new();

    for example in EXAMPLES {
        let (document, occurrences) = first_occurrences(definitions, &example)?;
        let first_found_here: MemberOccurrences = occurrences
            .into_iter()
            .filter(|(key, _)| seen_members.insert(key.clone()))
            .collect();

        examples.push((example.root, document, first_found_here));
    }

    Ok(examples)
}

/// The document of `example` and the first occurrence of each object member in it.
fn first_occurrences(
    definitions: &Definitions,
    example: &Example,
) -> Result<(Value, MemberOccurrences), String> {
    let root = example.root;
    let example: Value = serde_json::from_str(example.text).map_err(|error| error.to_string())?;
    let root_schema = definitions.get(root.root_definition())?;
    let mut walk = InstanceWalk {
        definitions,
        found: Vec::new(),
    };

    walk.walk(root_schema, Some(root.root_definition()), &example, "")?;

    let mut first = BTreeMap::new();

    for occurrence in walk.found {
        first
            .entry((occurrence.definition.clone(), occurrence.member.clone()))
            .or_insert(occurrence);
    }

    Ok((example, first))
}

fn registry_of_schema_open_enums(definitions: &Definitions) -> OpenEnumRegistry {
    definitions
        .0
        .iter()
        .filter_map(|(name, definition)| {
            let known_values = definition.get(KNOWN_VALUES_KEYWORD)?.as_array()?;
            let known_values = known_values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            let must_act = definition.get(MUST_ACT_KEYWORD) == Some(&Value::Bool(true));

            Some((name.clone(), (known_values, must_act)))
        })
        .collect()
}

fn registry_of_schema_unions(definitions: &Definitions) -> Result<UnionRegistry, String> {
    let mut unions = BTreeMap::new();

    for (name, definition) in &definitions.0 {
        let Some(tag_member) = definition
            .pointer("/discriminator/propertyName")
            .and_then(Value::as_str)
        else {
            continue;
        };
        let mut known_tags = Vec::new();

        for variant in definition
            .get("oneOf")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let reference = variant
                .get("$ref")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let (_, variant_definition) = definitions.referenced(reference)?;
            let tag = variant_definition
                .pointer(&format!("/properties/{tag_member}/const"))
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{name}: a variant without a tag const"))?;

            known_tags.push(tag.to_owned());
        }

        let must_act = definition.get(MUST_ACT_KEYWORD) == Some(&Value::Bool(true));

        unions.insert(name.clone(), (tag_member.to_owned(), known_tags, must_act));
    }

    Ok(unions)
}

#[test]
fn the_registries_list_every_open_enum_and_union_of_the_schemas_and_nothing_else() {
    let definitions = Definitions::load().unwrap();
    let registered_open_enums: OpenEnumRegistry = OPEN_ENUMS
        .iter()
        .map(|entry| {
            let known_values = entry
                .known_values
                .iter()
                .map(|value| (*value).to_owned())
                .collect();

            (entry.definition.to_owned(), (known_values, entry.must_act))
        })
        .collect();
    let registered_unions: UnionRegistry = UNIONS
        .iter()
        .map(|entry| {
            let known_tags = entry
                .known_tags
                .iter()
                .map(|tag| (*tag).to_owned())
                .collect();

            (
                entry.definition.to_owned(),
                (entry.tag_member.to_owned(), known_tags, entry.must_act),
            )
        })
        .collect();

    assert_eq!(
        registered_open_enums,
        registry_of_schema_open_enums(&definitions)
    );
    assert_eq!(
        registered_unions,
        registry_of_schema_unions(&definitions).unwrap()
    );
}

#[test]
fn the_examples_carry_every_member_of_every_object_definition() {
    let definitions = Definitions::load().unwrap();
    let seen_members: BTreeSet<(String, String)> = examples_with_first_occurrences(&definitions)
        .unwrap()
        .into_iter()
        .flat_map(|(_, _, occurrences)| occurrences.into_keys())
        .collect();

    let all_members = definitions.object_members();
    let missing_members: Vec<String> = all_members
        .keys()
        .filter(|member| !seen_members.contains(*member))
        .map(|(definition, member)| format!("{definition}.{member}"))
        .collect();

    assert_eq!(
        missing_members,
        Vec::<String>::new(),
        "of {} members",
        all_members.len()
    );
}

/// What decoding the example without one member gave, against what the schema requires.
fn required_mismatch(
    root: Root,
    example: &Value,
    occurrence: &MemberOccurrence,
    is_required: bool,
) -> Option<String> {
    let mut without_member = example.clone();
    let parent = without_member
        .pointer_mut(&occurrence.parent_pointer)?
        .as_object_mut()?;

    parent.remove(&occurrence.member);

    let name = format!("{}.{}", occurrence.definition, occurrence.member);

    match (root.rewrite(&without_member), is_required) {
        (Ok(_), true) => Some(format!(
            "{name}: required in the schema, decodes without it"
        )),
        (Err(error), false) => Some(format!(
            "{name}: optional in the schema, fails without it: {error}"
        )),
        _ => None,
    }
}

#[test]
fn a_member_is_required_in_the_types_exactly_when_the_schema_requires_it() {
    let definitions = Definitions::load().unwrap();
    let all_members = definitions.object_members();
    let mut mismatches = Vec::new();
    let mut checked_members = 0;

    for (root, example, occurrences) in examples_with_first_occurrences(&definitions).unwrap() {
        for (key, occurrence) in &occurrences {
            let is_required = all_members.get(key).copied().unwrap();

            checked_members += 1;
            mismatches.extend(required_mismatch(root, &example, occurrence, is_required));
        }
    }

    assert_eq!(mismatches, Vec::<String>::new());
    assert_eq!(checked_members, all_members.len());
}

/// The text of an integer, and the integer it must read as (`None`: refused).
struct IntegerCase {
    text: String,
    expected: Option<i64>,
}

fn integer_cases(member_schema: &Value, example_value: &Value) -> Result<Vec<IntegerCase>, String> {
    let bound = |keyword: &str| {
        member_schema
            .get(keyword)
            .and_then(Value::as_i64)
            .ok_or_else(|| format!("no integer {keyword}"))
    };
    let minimum = bound("minimum")?;
    let maximum = bound("maximum")?;
    let example_integer = example_value
        .as_i64()
        .ok_or("the example value is no integer")?;

    Ok(vec![
        IntegerCase {
            text: minimum.to_string(),
            expected: Some(minimum),
        },
        IntegerCase {
            text: maximum.to_string(),
            expected: Some(maximum),
        },
        IntegerCase {
            text: format!("{example_integer}.0"),
            expected: Some(example_integer),
        },
        IntegerCase {
            text: (minimum - 1).to_string(),
            expected: None,
        },
        IntegerCase {
            text: (maximum + 1).to_string(),
            expected: None,
        },
    ])
}

/// What the typed root read for `case` at the member, against what it should.
fn integer_mismatch(
    root: Root,
    example: &Value,
    occurrence: &MemberOccurrence,
    case: &IntegerCase,
) -> Option<String> {
    let mut document = example.clone();
    let pointer = occurrence.pointer();
    let name = format!(
        "{}.{} = {}",
        occurrence.definition, occurrence.member, case.text
    );
    let Ok(number) = serde_json::from_str::<Value>(&case.text) else {
        return Some(format!("{name}: the text does not parse"));
    };

    *document.pointer_mut(&pointer)? = number;

    let read_integer = root
        .rewrite(&document)
        .ok()
        .map(|rewritten| rewritten.pointer(&pointer).and_then(Value::as_i64));

    match (read_integer, case.expected) {
        (None, None) => None,
        (Some(Some(read)), Some(expected)) if read == expected => None,
        (read, _) => Some(format!("{name}: read {read:?}")),
    }
}

#[test]
fn every_integer_member_reads_its_bounds_and_float_form_and_refuses_beyond_them() {
    let definitions = Definitions::load().unwrap();
    let mut mismatches = Vec::new();
    let mut checked_members = 0;

    for (root, example, occurrences) in examples_with_first_occurrences(&definitions).unwrap() {
        let integer_occurrences = occurrences.values().filter(|occurrence| {
            occurrence.member_schema.get("type") == Some(&Value::from("integer"))
        });

        for occurrence in integer_occurrences {
            checked_members += 1;

            for case in integer_cases(&occurrence.member_schema, &occurrence.value).unwrap() {
                mismatches.extend(integer_mismatch(root, &example, occurrence, &case));
            }
        }
    }

    assert!(checked_members > 0, "no integer member found");
    assert_eq!(
        mismatches,
        Vec::<String>::new(),
        "of {checked_members} integer members"
    );
}
