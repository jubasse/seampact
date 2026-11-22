//! The contract diff's data, ported from `packages/core/diff/src`: the diff codes, the change
//! table, the [`DiffOptions`] and the [`DiffResult`] the diff answers.

mod diff_break;
mod diff_cell;
mod diff_classification;
mod diff_code;
mod diff_kind;
mod diff_position;
mod diff_table;
mod diff_value;
mod error;
mod ir_definition;
mod member_row;
mod member_rows_data;
mod options;
mod result;
mod table_json;

pub use diff_break::DiffBreak;
pub use diff_cell::{DiffCellOutcome, DiffFact, PlainCell, classify_cell};
pub use diff_classification::DiffClassification;
pub use diff_code::DiffCode;
pub use diff_kind::DiffKind;
pub use diff_position::DiffPosition;
pub use diff_value::DiffValue;
pub use error::DiffTableError;
pub use ir_definition::IrDefinition;
pub use member_row::{MemberRow, member_row};
pub use options::{
    DiffExemption, DiffGateScope, DiffOptions, ResolvedDiffOptions, resolve_diff_options,
};
pub use result::{
    DeprecationEntry, DiffCause, DiffChange, DiffComparison, DiffGateOutcome, DiffPolicies,
    DiffRefusal, DiffResult, DiffSettings, DiffSide, GateFailure, GateMaturity,
    OperationDeprecationStatus, SchemaDeprecationStatus,
};
pub use table_json::diff_table_json;
