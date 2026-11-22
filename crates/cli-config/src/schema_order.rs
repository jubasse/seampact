//! The order Ajv reports the failures of one value in, which the schema's own keyword order does not give.

use crate::schema_failure::SchemaFailure;

/// Keywords after which the next segment of a schema path is a name or an index, not a keyword.
const NAME_FOLLOWING_KEYWORDS: [&str; 8] = [
    "properties",
    "patternProperties",
    "$defs",
    "definitions",
    "dependencies",
    "oneOf",
    "anyOf",
    "allOf",
];

/// Ajv checks the keywords of one schema in this order: the generic ones first, then those of a
/// string, an array and an object; a keyword it does not list keeps its place after the others.
const AJV_KEYWORD_ORDER: [&str; 21] = [
    "$ref",
    "const",
    "enum",
    "not",
    "anyOf",
    "oneOf",
    "allOf",
    "if",
    "maxLength",
    "minLength",
    "pattern",
    "maxItems",
    "minItems",
    "uniqueItems",
    "items",
    "contains",
    "maxProperties",
    "minProperties",
    "required",
    "dependencies",
    "propertyNames",
];

/// The object keywords Ajv checks last, in this order, after [`AJV_KEYWORD_ORDER`].
const AJV_OBJECT_KEYWORD_TAIL: [&str; 3] =
    ["additionalProperties", "properties", "patternProperties"];

struct Pending {
    segments: Vec<String>,
    failure: SchemaFailure,
}

/// `failures` in Ajv's order: at each schema, its keywords in Ajv's order, the failures a keyword
/// holds before the keyword's own; failures at one place keep the order they came in.
pub(crate) fn in_ajv_order(failures: Vec<SchemaFailure>) -> Vec<SchemaFailure> {
    let pending = failures
        .into_iter()
        .map(|failure| Pending {
            segments: failure
                .schema_path
                .split('/')
                .skip(1)
                .map(str::to_owned)
                .collect(),
            failure,
        })
        .collect();

    arranged(pending, 0, false)
}

fn arranged(pending: Vec<Pending>, depth: usize, names_here: bool) -> Vec<SchemaFailure> {
    let mut own = Vec::new();
    let mut groups: Vec<(String, Vec<Pending>)> = Vec::new();

    for item in pending {
        let Some(segment) = item.segments.get(depth).cloned() else {
            own.push(item.failure);

            continue;
        };

        match groups.iter_mut().find(|(key, _)| *key == segment) {
            Some((_, members)) => members.push(item),
            None => groups.push((segment, vec![item])),
        }
    }

    if !names_here {
        groups.sort_by_key(|(keyword, _)| keyword_rank(keyword));
    }

    let mut ordered = Vec::new();

    for (segment, members) in groups {
        let names_next = !names_here && NAME_FOLLOWING_KEYWORDS.contains(&segment.as_str());

        ordered.extend(arranged(members, depth + 1, names_next));
    }

    ordered.extend(own);

    ordered
}

fn keyword_rank(keyword: &str) -> usize {
    if let Some(rank) = AJV_KEYWORD_ORDER.iter().position(|each| *each == keyword) {
        return rank;
    }

    match AJV_OBJECT_KEYWORD_TAIL
        .iter()
        .position(|each| *each == keyword)
    {
        Some(rank) => AJV_KEYWORD_ORDER.len() + rank,
        None => AJV_KEYWORD_ORDER.len() + AJV_OBJECT_KEYWORD_TAIL.len(),
    }
}
