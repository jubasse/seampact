//! Validated relative output paths, their case-insensitive clashes and the untrusted entry rules.
//!
//! Every path a seampact command writes below an output root is a [`RelativeOutputPath`]:
//! [`RelativeOutputPath::try_new`] refuses what could leave the root, for the reasons of
//! [`UnsafePathReason`]. An [`OutputPathSet`] then refuses two paths one case-insensitive or
//! normalising file system reads as one name. [`untrusted_entry_problem`] applies the same rules,
//! in the bundle readers' order, to the entries of a tarball or a git tree. [`node_path`] is the one
//! port of Node's `path` arithmetic and `node_modules` lookup.

mod case_folded;
pub mod node_path;
mod output_path_set;
mod relative_output_path;
mod unsafe_path_reason;

pub use case_folded::{case_folded, nfc_case_folded};
pub use output_path_set::{OutputPathClash, OutputPathSet};
pub use relative_output_path::{ParseOutputPathError, RelativeOutputPath};
pub use unsafe_path_reason::{UnsafePathReason, untrusted_entry_problem};
