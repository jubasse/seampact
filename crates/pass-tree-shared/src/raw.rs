//! Reading the merged raw tree, the conventions and the draft's schemas: the small helpers every
//! part of `tree.nodes` shares.

use seampact_diagnostics::InternalError;
use seampact_ir::{Direction, Maturity, ObjectSchema, Origin, Schema, TypeUse, UnionTag};
use seampact_json::JsonValue;
use seampact_pipeline::{
    DraftIr, HalfContext, PassError, ResolvedConventions, TreeNode, TreeSchemaService,
    pointer_below,
};

/// The maturity levels, least first (ADR 0002 section 5).
pub const TREE_NODES_MATURITIES: [Maturity; 3] = [
    Maturity::Experimental,
    Maturity::Provisional,
    Maturity::Stable,
];

/// A convention as written at its own leaf, with its origin.
#[derive(Debug, Clone, PartialEq)]
pub struct WrittenConvention<'run> {
    /// The raw value.
    pub value: &'run JsonValue,
    /// Where the leaf is written.
    pub origin: Origin,
}

/// The use the schema service answers at `pointer`.
///
/// It answers every position `tree.schemas` accepted, and a refused one stops the run before this
/// half (the stop rule), so no answer is an internal error.
///
/// # Errors
///
/// A [`PassError`] from the service, or an internal one when it answers nothing.
pub fn tree_nodes_answered_use(
    schemas: &dyn TreeSchemaService,
    pointer: &str,
    direction: &Direction,
) -> Result<TypeUse, PassError> {
    let Some(answered) = schemas.type_use(pointer, direction.clone())? else {
        return Err(InternalError::new(format!(
            "the schema service answers no {direction} type at {pointer}"
        ))
        .into());
    };

    Ok(answered)
}

/// A convention as written at its own leaf, with its origin.
///
/// `None` for a core default or one read elsewhere.
///
/// # Errors
///
/// An [`InternalError`] for a path that is no leaf of the conventions schema.
pub fn tree_nodes_written_convention<'run>(
    conventions: ResolvedConventions<'run>,
    path: &str,
) -> Result<Option<WrittenConvention<'run>>, InternalError> {
    let reading = conventions.get(path)?;
    let segments: Vec<&str> = path.split('.').collect();
    let pointer = pointer_below("/conventions", &segments);

    let Some(reading) = reading else {
        return Ok(None);
    };
    let Some(origin) = reading.origin else {
        return Ok(None);
    };

    if origin.pointer != pointer {
        return Ok(None);
    }

    Ok(Some(WrittenConvention {
        value: reading.value,
        origin,
    }))
}

/// A member of a raw mapping, `None` when the value is no mapping or lacks it.
#[must_use]
pub fn tree_nodes_member<'tree>(
    value: Option<&'tree JsonValue>,
    key: &str,
) -> Option<&'tree JsonValue> {
    match value {
        Some(JsonValue::Object(object)) => object.get(key),
        _ => None,
    }
}

/// A setting written on a tree node.
#[must_use]
pub fn tree_nodes_setting<'node>(node: &'node TreeNode<'_>, key: &str) -> Option<&'node JsonValue> {
    node.settings.get(key)
}

/// A setting written on a tree node as text, else `None`.
#[must_use]
pub fn tree_nodes_text<'node>(node: &'node TreeNode<'_>, key: &str) -> Option<&'node str> {
    match tree_nodes_setting(node, key) {
        Some(JsonValue::String(text)) => Some(text),
        _ => None,
    }
}

/// The origin of a raw pointer, else of the nearest pointer above it the raw tree locates.
///
/// A member left out is located at its owner.
///
/// # Errors
///
/// An [`InternalError`] when nothing is located up to the root.
pub fn tree_nodes_origin_at(
    context: &HalfContext<'_>,
    pointer: &str,
) -> Result<Origin, InternalError> {
    let mut current = pointer;

    while !current.is_empty() {
        if let Some(origin) = context.origin(current) {
            return Ok(origin);
        }

        let Some((above, _)) = current.rsplit_once('/') else {
            break;
        };

        current = above;
    }

    Err(InternalError::new(format!(
        "the raw tree locates nothing at or above {pointer}"
    )))
}

/// A schema of the draft's catalogue, read by its id.
#[must_use]
pub fn tree_nodes_schema<'draft>(draft: &'draft DraftIr, id: &str) -> Option<&'draft Schema> {
    draft.schemas.get(id)
}

/// A schema of the draft's catalogue that a use refers to.
///
/// `tree.schemas` writes every schema a use it answers refers to, so a missing one is an
/// internal error.
///
/// # Errors
///
/// An [`InternalError`] when the draft holds no such schema.
pub fn tree_nodes_draft_schema<'draft>(
    draft: &'draft DraftIr,
    id: &str,
) -> Result<&'draft Schema, InternalError> {
    tree_nodes_schema(draft, id).ok_or_else(|| {
        InternalError::new(format!(
            "the draft holds no schema {id}, which a use refers to"
        ))
    })
}

// The schema a use refers to, when the use is a reference.
fn referred_schema<'draft>(
    draft: &'draft DraftIr,
    used: Option<&TypeUse>,
) -> Option<&'draft Schema> {
    match used {
        Some(TypeUse::Ref(reference)) => tree_nodes_schema(draft, reference.schema.as_str()),
        _ => None,
    }
}

/// The object schema a use refers to, else `None`.
#[must_use]
pub fn tree_nodes_object_of<'draft>(
    draft: &'draft DraftIr,
    used: Option<&TypeUse>,
) -> Option<&'draft ObjectSchema> {
    match referred_schema(draft, used) {
        Some(Schema::Object(object)) => Some(object),
        _ => None,
    }
}

/// The header a union reads its tag from, when the use refers to a header-tagged union.
#[must_use]
pub fn tree_nodes_tag_header<'draft>(
    draft: &'draft DraftIr,
    used: Option<&TypeUse>,
) -> Option<&'draft str> {
    match referred_schema(draft, used) {
        Some(Schema::Union(union)) => match &union.tag {
            UnionTag::Header(header) => Some(&header.name),
            _ => None,
        },
        _ => None,
    }
}
