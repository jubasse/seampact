//! What a diff answers: the refusals that stop it, or the changes, the gate and the deprecations.

use seampact_ir::{ApiVersion, CompatPolicy, MaturitySource, PackRef};

use crate::diff_break::DiffBreak;
use crate::diff_classification::DiffClassification;
use crate::diff_code::DiffCode;
use crate::diff_kind::DiffKind;
use crate::diff_position::DiffPosition;
use crate::diff_value::DiffValue;
use crate::{DiffExemption, DiffGateScope};

/// Why two contracts cannot be compared.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffRefusal {
    /// The refusal's code.
    pub code: DiffCode,
    /// What is wrong.
    pub message: String,
    /// How to fix it.
    pub fix: String,
    /// The `before` value, when the refusal reports one.
    pub before: Option<DiffValue>,
    /// The `after` value, when the refusal reports one.
    pub after: Option<DiffValue>,
    /// The IR member holding an unknown value.
    pub member: Option<String>,
    /// The ids of the operations that hold it.
    pub operations: Option<Vec<String>>,
}

/// The version, IR revision and packs of one side.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffSide {
    /// The api version.
    pub version: ApiVersion,
    /// The IR revision.
    pub ir_revision: i64,
    /// The packs applied, in order.
    pub packs: Vec<PackRef>,
}

/// The pack whose upgrade caused a change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffCause {
    /// The pack, read from the element's `Origin.layer`.
    pub pack: String,
}

/// One change between the two contracts, with its code and level.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffChange {
    /// The row of the classification table.
    pub kind: DiffKind,
    /// The row's case, or the IR member for `unclassified`.
    pub case_name: String,
    /// A JSON Pointer into `after`, into `before` for a removal.
    pub pointer: String,
    /// Where the change is reached from.
    pub position: DiffPosition,
    /// The ids of the operations that reach the change, sorted; empty for an api-wide change.
    pub operations: Vec<String>,
    /// The sides the change breaks.
    pub breaks: Vec<DiffBreak>,
    /// The change's classification.
    pub classification: DiffClassification,
    /// The value before.
    pub before: Option<DiffValue>,
    /// The value after.
    pub after: Option<DiffValue>,
    /// The pack whose upgrade caused the change.
    pub cause: Option<DiffCause>,
    /// The exemption that keeps a breaking change from failing the gate.
    pub exemption: Option<DiffExemption>,
}

/// The stable operation behind a `diff.maturity.stable` failure.
#[derive(Debug, Clone, PartialEq)]
pub struct GateMaturity {
    /// The stable operation; absent for the api itself.
    pub operation: Option<String>,
    /// Its maturity level.
    pub level: String,
    /// Where the level comes from.
    pub source: MaturitySource,
}

/// A change that fails the gate.
#[derive(Debug, Clone, PartialEq)]
pub struct GateFailure {
    /// The failure's code.
    pub code: DiffCode,
    /// What failed.
    pub message: String,
    /// How to fix it.
    pub fix: String,
    /// The change's row.
    pub kind: DiffKind,
    /// The change's case.
    pub case_name: String,
    /// The change's pointer.
    pub pointer: String,
    /// Where the change is reached from.
    pub position: DiffPosition,
    /// The sides the change breaks.
    pub breaks: Vec<DiffBreak>,
    /// The ids of the operations that reach the change.
    pub operations: Vec<String>,
    /// For `diff.maturity.stable`: the stable operation, its level and its source.
    pub maturity: Option<GateMaturity>,
}

/// What became of an operation deprecated in `after`, or deprecated in `before` and gone from `after`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OperationDeprecationStatus {
    /// `new`.
    New,
    /// `kept`.
    Kept,
    /// `sunsetEarlier`.
    SunsetEarlier,
    /// `sunsetLater`.
    SunsetLater,
    /// `successorChanged`.
    SuccessorChanged,
    /// `removed`.
    Removed,
    /// `sunsetPassed`.
    SunsetPassed,
}

impl OperationDeprecationStatus {
    /// The status as the report writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Kept => "kept",
            Self::SunsetEarlier => "sunsetEarlier",
            Self::SunsetLater => "sunsetLater",
            Self::SuccessorChanged => "successorChanged",
            Self::Removed => "removed",
            Self::SunsetPassed => "sunsetPassed",
        }
    }
}

/// `deprecated` set in `after`, or cleared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SchemaDeprecationStatus {
    /// `deprecated`.
    Deprecated,
    /// `undeprecated`.
    Undeprecated,
}

impl SchemaDeprecationStatus {
    /// The status as the report writes it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Deprecated => "deprecated",
            Self::Undeprecated => "undeprecated",
        }
    }
}

/// What became of a deprecated operation, schema or property.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeprecationEntry {
    /// An operation (`subject: "operation"`).
    Operation {
        /// The operation id.
        operation: String,
        /// A JSON Pointer to the operation.
        pointer: String,
        /// What became of it.
        status: OperationDeprecationStatus,
        /// The deprecation date.
        since: String,
        /// The sunset date.
        sunset: String,
        /// The successor operation id.
        successor: Option<String>,
        /// Days from `options.today` to the sunset, negative once past.
        days_to_sunset: i64,
        /// The sunset is on or before `options.today`.
        past_sunset: bool,
    },
    /// A schema (`subject: "schema"`).
    Schema {
        /// A JSON Pointer to the schema.
        pointer: String,
        /// The schema id.
        schema: String,
        /// Whether it is deprecated now.
        status: SchemaDeprecationStatus,
    },
    /// A property (`subject: "property"`).
    Property {
        /// A JSON Pointer to the property.
        pointer: String,
        /// The schema id.
        schema: String,
        /// The property name.
        property: String,
        /// Whether it is deprecated now.
        status: SchemaDeprecationStatus,
    },
}

/// The policies of both sides and the one applied.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffPolicies {
    /// The `before` member.
    pub before: CompatPolicy,
    /// The `after` member.
    pub after: CompatPolicy,
    /// The `applied` member.
    pub applied: CompatPolicy,
}

/// The gate settings applied, defaults filled in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffSettings {
    /// The `gate` member.
    pub gate: DiffGateScope,
    /// The `exempt` member.
    pub exempt: Vec<DiffExemption>,
}

/// Whether the gate passed, and the changes that failed it.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffGateOutcome {
    /// The `passed` member.
    pub passed: bool,
    /// The `failures` member.
    pub failures: Vec<GateFailure>,
}

/// The comparison of two contracts that could be compared.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffComparison {
    /// The api name.
    pub api: String,
    /// The `before` side.
    pub before: DiffSide,
    /// The `after` side.
    pub after: DiffSide,
    /// The `policy` member.
    pub policy: DiffPolicies,
    /// The `settings` member.
    pub settings: DiffSettings,
    /// Every change, in report order.
    pub changes: Vec<DiffChange>,
    /// The `gate` member.
    pub gate: DiffGateOutcome,
    /// The `deprecations` member.
    pub deprecations: Vec<DeprecationEntry>,
}

/// What a diff answers: `{ ok: false, refusals }` or `{ ok: true, ... }`.
#[derive(Debug, Clone, PartialEq)]
pub enum DiffResult {
    /// The contracts cannot be compared.
    Refused(Vec<DiffRefusal>),
    /// The comparison.
    Compared(Box<DiffComparison>),
}
