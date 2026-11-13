//! The conventions a pass reads (ADR 0002 section 13, ADR 0006 section 2): the merged
//! `conventions` of the api's layers, each value with the origin of the layer that wrote it, or the
//! core default with no origin.
//!
//! The IR `conventions` map lists only written conventions, so a default never reaches it with a
//! made-up origin.

use std::sync::{LazyLock, OnceLock};

use indexmap::IndexMap;
use regress::Regex;
use seampact_authoring::{JsonObjectExt, RawApi};
use seampact_diagnostics::InternalError;
use seampact_ir::Origin;
use seampact_json::{JsonNumber, JsonObject, JsonValue};

use super::authoring_schema::authoring_schema;
use super::pointer::{json_at_object, pipeline_origin, pointer_below};
use crate::derivations::derivation_roles;

/// The `cache.sensitiveElsewhere` value that refuses a sensitive value outside a body field; the
/// default is `noStore`.
pub const SENSITIVE_ELSEWHERE_REFUSE: &str = "refuse";

const CONVENTIONS_MEMBER: &str = "conventions";

/// The member that makes a conventions fragment include another; never a convention path.
const INCLUDE_MEMBER: &str = "$include";

/// A convention value: written (with its origin) or the core default (no origin).
#[derive(Debug, Clone, PartialEq)]
pub struct ConventionReading<'run> {
    /// The raw value, or the default.
    pub value: &'run JsonValue,
    /// Absent for a core default of ADR 0002 section 13.
    pub origin: Option<Origin>,
}

// The `ops` table of ADR 0002 section 6: method, path relative to the op's scope, success status.
const OPS: [(&str, &str, &str, u16); 6] = [
    ("list", "get", "", 200),
    ("get", "get", "", 200),
    ("create", "post", "", 201),
    ("update", "patch", "", 200),
    ("delete", "delete", "", 204),
    ("batch", "post", "batch", 200),
];

// The leaves of the conventions authoring schema but the `ops` ones; a test keeps them equal to
// the schema's.
#[cfg(test)]
const LEAVES: [&str; 44] = [
    "format",
    "pathCase",
    "paging.default",
    "paging.maxLimit",
    "paging.defaultLimit",
    "paging.overLimit",
    "idempotency.header",
    "idempotency.replayHeader",
    "idempotency.lifetime",
    "idempotency.methods",
    "idempotency.required",
    "idempotency.enforce",
    "bodyLimit",
    "batch.maxIds",
    "batch.bodyLimit",
    "batch.budget",
    "cache.families",
    "cache.sensitiveElsewhere",
    "restrictedInput",
    "outputEnums",
    "pathVersion",
    "query.lists",
    "query.objects",
    "query.unknownKeys",
    "input.unknownKeys",
    "int64",
    "deprecation.header",
    "deprecation.sunsetHeader",
    "deprecation.successorRel",
    "operationIds.order",
    "operationIds.case",
    "rateLimit.header",
    "rateLimit.param",
    "rateLimit.unit",
    "degradedHeader",
    "urls",
    "rights.pattern",
    "service.allowPublic",
    "access.guestRule",
    "errors.pattern",
    "errors.every",
    "errors.reach",
    "errors.requireCode",
    "errors.derived",
];

/// Every leaf a convention path names, map entries aside; a test keeps it equal to the schema's
/// leaves.
#[cfg(test)]
fn convention_leaves() -> Vec<String> {
    let ops = OPS
        .iter()
        .flat_map(|(op, ..)| ["method", "path", "status"].map(|field| format!("ops.{op}.{field}")));

    LEAVES.iter().map(ToString::to_string).chain(ops).collect()
}

/// What one core default holds.
#[derive(Debug, Clone, PartialEq)]
pub enum ConventionDefaultValue {
    /// A value; `within` limits it to a convention that is written at all (the defaults of
    /// `idempotency` apply only when `idempotency` is set, since an unset `idempotency` derives no
    /// key).
    Value {
        /// The default.
        value: JsonValue,
        /// A top-level convention (an object), which must be written for the default to apply.
        within: Option<&'static str>,
    },
    /// Another key's reading, which then carries that key's origin.
    From(&'static str),
}

/// One core default of ADR 0002 section 13, at a leaf path.
#[derive(Debug, Clone, PartialEq)]
pub struct ConventionDefault {
    /// The leaf path.
    pub path: String,
    /// The default.
    pub value: ConventionDefaultValue,
}

fn plain(path: &str, value: JsonValue) -> ConventionDefault {
    ConventionDefault {
        path: path.to_owned(),
        value: ConventionDefaultValue::Value {
            value,
            within: None,
        },
    }
}

fn text(path: &str, value: &str) -> ConventionDefault {
    plain(path, JsonValue::String(value.to_owned()))
}

fn within_idempotency(path: &str, value: JsonValue) -> ConventionDefault {
    ConventionDefault {
        path: path.to_owned(),
        value: ConventionDefaultValue::Value {
            value,
            within: Some("idempotency"),
        },
    }
}

fn from_other(path: &str, other: &'static str) -> ConventionDefault {
    ConventionDefault {
        path: path.to_owned(),
        value: ConventionDefaultValue::From(other),
    }
}

fn strings(items: &[&str]) -> JsonValue {
    JsonValue::Array(
        items
            .iter()
            .map(|item| JsonValue::String((*item).to_owned()))
            .collect(),
    )
}

fn ops_defaults() -> Result<Vec<ConventionDefault>, InternalError> {
    let mut defaults = Vec::new();

    for (op, method, path, status) in OPS {
        let status_number = JsonNumber::from_f64(f64::from(status))
            .ok_or_else(|| InternalError::new(format!("the status {status} is not a number")))?;

        defaults.push(text(&format!("ops.{op}.method"), method));
        defaults.push(text(&format!("ops.{op}.path"), path));
        defaults.push(plain(
            &format!("ops.{op}.status"),
            JsonValue::Number(status_number),
        ));
    }

    Ok(defaults)
}

// The core defaults of ADR 0002 section 13, in the order of the table; a key without a default
// (`paging.default`, `rateLimit`, `idempotency.header`) is absent.
fn build_defaults() -> Result<Vec<ConventionDefault>, InternalError> {
    let mut defaults = vec![
        text("format", "bare"),
        text("pathCase", "kebab"),
        from_other("paging.defaultLimit", "paging.maxLimit"),
        text("paging.overLimit", "reject"),
        within_idempotency(
            "idempotency.methods",
            strings(&["post", "put", "patch", "delete"]),
        ),
        within_idempotency("idempotency.required", JsonValue::Bool(true)),
        within_idempotency(
            "idempotency.enforce",
            JsonValue::String("boundary".to_owned()),
        ),
        text("bodyLimit", "1MiB"),
        from_other("batch.bodyLimit", "bodyLimit"),
        plain("cache.families", JsonValue::Object(JsonObject::new())),
        text("cache.sensitiveElsewhere", "noStore"),
        text("restrictedInput", "reject"),
        text("outputEnums", "enum"),
        text("pathVersion", "prefix"),
        text("query.lists", "repeat"),
        text("query.objects", "explode"),
        text("query.unknownKeys", "refuse"),
        text("input.unknownKeys", "refuse"),
        text("int64", "string"),
        text("deprecation.header", "Deprecation"),
        text("deprecation.sunsetHeader", "Sunset"),
        text("deprecation.successorRel", "successor-version"),
    ];

    defaults.extend(ops_defaults()?);
    defaults.extend([
        text("operationIds.order", "verbNoun"),
        text("operationIds.case", "camel"),
        text("urls", "relative"),
        plain("service.allowPublic", JsonValue::Bool(false)),
        text("access.guestRule", "refuse"),
        plain("errors.every", JsonValue::Array(Vec::new())),
        text("errors.reach", "subtree"),
        plain("errors.requireCode", JsonValue::Bool(true)),
    ]);
    // A34: each role is bound to its default code (ADR 0006 section 6) unless a layer binds it.
    defaults.extend(derivation_roles().iter().map(|role| {
        text(
            &format!("errors.derived.{}", role.role.as_str()),
            role.default_code,
        )
    }));

    Ok(defaults)
}

static DEFAULTS: LazyLock<Result<Vec<ConventionDefault>, InternalError>> =
    LazyLock::new(build_defaults);

/// The core defaults of ADR 0002 section 13.
///
/// # Errors
///
/// An [`InternalError`] when the table cannot be built.
pub fn convention_defaults() -> Result<&'static [ConventionDefault], InternalError> {
    DEFAULTS.as_ref().map(Vec::as_slice).map_err(Clone::clone)
}

/// The leaves of the conventions authoring schema, each with the key pattern of its entries when it
/// is a map.
pub type ConventionSchemaLeaves = IndexMap<String, Option<Regex>>;

static SCHEMA_LEAVES: OnceLock<ConventionSchemaLeaves> = OnceLock::new();

// A closed object is walked into, anything else is a leaf.
fn walk_schema(
    schema: &JsonValue,
    prefix: &str,
    leaves: &mut ConventionSchemaLeaves,
) -> Result<(), InternalError> {
    let JsonValue::Object(schema_object) = schema else {
        return Ok(());
    };
    let Some(properties) = schema_object.object("properties") else {
        return Ok(());
    };

    for (key, item) in properties {
        let JsonValue::Object(item_object) = item else {
            continue;
        };

        if key == INCLUDE_MEMBER {
            continue;
        }

        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        let closed_object = item_object.string("type") == Some("object")
            && item_object.member("additionalProperties") == Some(&JsonValue::Bool(false));

        if closed_object {
            walk_schema(item, &path, leaves)?;
            continue;
        }

        let pattern = item_object
            .object("propertyNames")
            .and_then(|names| names.string("pattern"));
        let key_pattern = pattern
            .map(|source| {
                Regex::new(source).map_err(|error| {
                    InternalError::new(format!(
                        "the conventions key pattern {source} is invalid: {error}"
                    ))
                })
            })
            .transpose()?;

        leaves.insert(path, key_pattern);
    }

    Ok(())
}

fn read_schema_leaves() -> Result<ConventionSchemaLeaves, InternalError> {
    let mut leaves = IndexMap::new();
    let conventions = authoring_schema("conventions")?
        .object("$defs")
        .and_then(|definitions| definitions.member(CONVENTIONS_MEMBER));

    if let Some(schema) = conventions {
        walk_schema(schema, "", &mut leaves)?;
    }

    if leaves.is_empty() {
        return Err(InternalError::new(
            "the conventions authoring schema has no leaf",
        ));
    }

    Ok(leaves)
}

/// The leaves of the conventions authoring schema, each with the key pattern of its entries when it
/// is a map, built once.
///
/// # Errors
///
/// An [`InternalError`] when the embedded schema has no leaf or a key pattern does not compile.
pub fn convention_schema_leaves() -> Result<&'static ConventionSchemaLeaves, InternalError> {
    if let Some(leaves) = SCHEMA_LEAVES.get() {
        return Ok(leaves);
    }

    let leaves = read_schema_leaves()?;

    Ok(SCHEMA_LEAVES.get_or_init(|| leaves))
}

// Whether `path` is a schema leaf, or one entry of a map leaf whose key its pattern accepts.
fn is_convention_path(path: &str) -> Result<bool, InternalError> {
    let leaves = convention_schema_leaves()?;

    if leaves.contains_key(path) {
        return Ok(true);
    }

    let Some((map_path, key)) = path.rsplit_once('.') else {
        return Ok(false);
    };
    let entries = leaves.get(map_path).and_then(Option::as_ref);

    Ok(key != INCLUDE_MEMBER && entries.is_some_and(|pattern| pattern.find(key).is_some()))
}

/// The conventions of one api: written values with their origins, else the core defaults.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedConventions<'run> {
    raw: &'run RawApi,
}

/// The conventions of one api.
#[must_use]
pub const fn pipeline_conventions(raw: &RawApi) -> ResolvedConventions<'_> {
    ResolvedConventions { raw }
}

impl<'run> ResolvedConventions<'run> {
    /// The value at a dotted path under `conventions` (`bodyLimit`, `idempotency.header`,
    /// `errors.derived.notFound`), or its core default; `None` when neither is set.
    ///
    /// A map leaf (`cache.families`) is returned as written, and the origin of a map several
    /// layers write into is the last of them.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] for a path that is no leaf of the conventions schema, nor an entry of
    /// a map leaf (a typo, or an object such as `idempotency`).
    pub fn get(self, path: &str) -> Result<Option<ConventionReading<'run>>, InternalError> {
        if !is_convention_path(path)? {
            return Err(InternalError::new(format!(
                "conventions.{path} is no leaf of the conventions schema (ADR 0002 section 13): read a \
                 leaf such as bodyLimit or idempotency.header, or an entry such as errors.derived.notFound"
            )));
        }

        self.read(path, 0)
    }

    // `depth` bounds a chain of `from` defaults, so a table mistake cannot loop.
    fn read(
        self,
        path: &str,
        depth: usize,
    ) -> Result<Option<ConventionReading<'run>>, InternalError> {
        let segments: Vec<&str> = path.split('.').collect();
        let written = self
            .raw
            .merged
            .object(CONVENTIONS_MEMBER)
            .and_then(|conventions| json_at_object(conventions, &segments));

        if let Some(value) = written {
            let origin = pipeline_origin(
                self.raw,
                &pointer_below(&format!("/{CONVENTIONS_MEMBER}"), &segments),
            );

            return Ok(Some(ConventionReading { value, origin }));
        }

        let defaults = convention_defaults()?;
        let Some(fallback) = defaults.iter().find(|entry| entry.path == path) else {
            return Ok(None);
        };

        if depth > defaults.len() {
            return Ok(None);
        }

        match &fallback.value {
            ConventionDefaultValue::From(other) => self.read(other, depth + 1),
            ConventionDefaultValue::Value { value, within } => {
                if let Some(parent) = within
                    && self.read(parent, depth + 1)?.is_none()
                {
                    return Ok(None);
                }

                Ok(Some(ConventionReading {
                    value,
                    origin: None,
                }))
            }
        }
    }
}

/// The param `conventions.rateLimit` names for `rateLimited`'s delay, if any.
///
/// # Errors
///
/// An [`InternalError`] when the conventions cannot be read.
pub fn pipeline_rate_limit_param(
    conventions: ResolvedConventions<'_>,
) -> Result<Option<&str>, InternalError> {
    Ok(match conventions.get("rateLimit.param")? {
        Some(ConventionReading {
            value: JsonValue::String(param),
            ..
        }) => Some(param.as_str()),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use seampact_js::cmp_utf16;

    use super::*;

    fn sorted(mut paths: Vec<String>) -> Vec<String> {
        paths.sort_by(|left, right| cmp_utf16(left, right));

        paths
    }

    #[test]
    fn the_convention_paths_equal_the_conventions_schemas_leaves() {
        let schema = convention_schema_leaves()
            .unwrap()
            .keys()
            .cloned()
            .collect();

        assert_eq!(sorted(convention_leaves()), sorted(schema));
    }

    #[test]
    fn the_schema_leaves_are_built_once() {
        let first = convention_schema_leaves().unwrap();
        let second = convention_schema_leaves().unwrap();

        assert!(std::ptr::eq(first, second));
    }

    #[test]
    fn a_map_leaf_key_pattern_reads_as_an_unflagged_regular_expression() {
        let leaves = convention_schema_leaves().unwrap();
        let families = leaves.get("cache.families").unwrap().as_ref().unwrap();

        assert!(families.find("minute").is_some());
        assert!(families.find("Minute").is_none());
        assert!(families.find("").is_none());
    }
}
