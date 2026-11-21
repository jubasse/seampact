//! What a diff answers: the refusals that stop it, or the changes, the gate and the deprecations.

use crate::{DiffExemption, DiffGateScope};

/// Why two contracts cannot be compared.
///
/// Declared by the brief that ports `result.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum DiffRefusal {}

/// The version, IR revision and packs of one side.
///
/// Declared by the brief that ports `result.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum DiffSide {}

/// The compatibility policy a side declares.
///
/// Declared by the brief that ports `result.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum CompatPolicy {}

/// One change between the two contracts, with its code and level.
///
/// Declared by the brief that ports `result.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum DiffChange {}

/// A change that fails the gate.
///
/// Declared by the brief that ports `result.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum GateFailure {}

/// What became of a deprecated operation, schema or property.
///
/// Declared by the brief that ports `result.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum DeprecationEntry {}

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
