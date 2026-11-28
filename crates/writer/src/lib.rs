//! Writes and checks generated files: paths, headers, formatting, the manifest and hand edits.

mod error;
mod existing_file;
mod file_presence;
mod finish_files;
mod generated_paths;
mod generated_write;
mod hand_edit_policy;
mod manifest;
mod root_directory;
mod sha256;
mod write_stop;

pub use error::WriterError;
pub use file_presence::read_file_if_present;
pub use finish_files::{HeaderSource, finish_files, generated_header};
pub use generated_paths::{MANIFEST_FILE_NAME, check_generated_paths};
pub use generated_write::{
    PlannedWrite, WrittenFiles, commit_generated_write, plan_generated_write, write_generated_files,
};
pub use hand_edit_policy::HandEditPolicy;
pub use manifest::{ManifestEntry, ManifestRead, read_manifest, serialize_manifest};
pub use write_stop::WriteStop;
