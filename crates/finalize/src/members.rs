//! The members finalize writes: `irVersion`, `irRevision`, the declaration `kinds` present, and the
//! must-understand `features` each operation uses, with their union on top.

use seampact_ir::{DeclarationKind, Feature, IR_REVISION, IR_VERSION};
use seampact_js::cmp_utf16;
use seampact_json::JsonObject;

/// One must-understand feature: its name and whether an operation of the complete draft uses it.
#[derive(Debug, Clone)]
pub struct FeatureRow {
    /// The feature.
    pub feature: Feature,
    /// Whether the operation uses it.
    pub used_by: fn(&JsonObject) -> bool,
}

/// The member-to-feature table: empty at this irRevision, since every member is understood by
/// every target.
pub const FEATURE_TABLE: &[FeatureRow] = &[];

/// The top-level members finalize writes.
#[derive(Debug, Clone, PartialEq)]
pub struct FinalizeMembers {
    /// The `irVersion` member.
    pub ir_version: i64,
    /// The `irRevision` member.
    pub ir_revision: i64,
    /// The `kinds` member.
    pub kinds: Vec<DeclarationKind>,
    /// The `features` member.
    pub features: Vec<Feature>,
}

fn sorted_once(mut features: Vec<Feature>) -> Vec<Feature> {
    let mut once: Vec<Feature> = Vec::with_capacity(features.len());

    for feature in features.drain(..) {
        if !once.contains(&feature) {
            once.push(feature);
        }
    }

    once.sort_by(|left, right| cmp_utf16(left.as_str(), right.as_str()));

    once
}

/// The features an operation uses, sorted, each once.
#[must_use]
pub fn finalize_operation_features(
    operation: &JsonObject,
    feature_table: &[FeatureRow],
) -> Vec<Feature> {
    let used: Vec<Feature> = feature_table
        .iter()
        .filter(|row| (row.used_by)(operation))
        .map(|row| row.feature.clone())
        .collect();

    sorted_once(used)
}

/// The top-level members, from the features each operation uses.
#[must_use]
pub fn finalize_members(operation_features: &[Vec<Feature>]) -> FinalizeMembers {
    let features: Vec<Feature> = operation_features.iter().flatten().cloned().collect();
    // An operation is an `httpOperation`, the one declaration kind of this irVersion.
    let kinds = if operation_features.is_empty() {
        Vec::new()
    } else {
        vec![DeclarationKind::HttpOperation]
    };

    FinalizeMembers {
        ir_version: IR_VERSION,
        ir_revision: IR_REVISION,
        kinds,
        features: sorted_once(features),
    }
}
