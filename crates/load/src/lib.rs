//! The load stage of the Rust port: the workspace readers, the load limits and their budget, the
//! load diagnostics and the include fragments.
//!
//! [`LoadReader`] is the only way the loader reaches files ([`FsReader`] on disk, [`MemoryReader`]
//! in tests). Paths are root-relative strings with `/`: [`resolve_authored_path`] and
//! [`check_case`] decide whether an authored path stays inside its boundary and matches the disk.
//! The limits ([`LOAD_MAX_WORK`] and the others) are charged to one [`LoadBudget`]; a diagnostic is
//! reported through the [`Reporter`] under a [`LoadRule`].

mod budget;
mod fragments;
mod json;
mod limits;
mod pack_files;
mod paths;
pub mod positions;
mod reader;
mod report;

pub use budget::{LoadBudget, load_work_of, utf16_length};
pub use fragments::{LoadFragment, load_sort_fragments};
pub use json::{RESERVED_KEYS, is_reserved_key, show_value};
pub use limits::{LOAD_MAX_DEPTH, LOAD_MAX_FILE_BYTES, LOAD_MAX_TEXT, LOAD_MAX_WORK};
pub use pack_files::{
    PackFileParts, pack_file_parts, pack_layer_id_of, pack_vendored_directory, pack_vendored_file,
    package_name_of, split_pack_file,
};
pub use paths::{
    CaseCheck, ListingIndexes, PathProblem, ROOT_BOUNDARY, ResolvedPath, check_case, dirname_of,
    is_absolute_path, is_inside, join_path, load_normalize_path, pointer_segments,
    resolve_authored_path,
};
pub use reader::{
    FsReader, FsReaderError, LoadReader, LoadText, MemoryReader, load_ascent_of, load_root_relative,
};
pub use report::{
    LoadMessage, LoadRule, PendingDiagnostic, RelatedSite, Reporter, diagnostic_layer_of,
    load_site_pointer, text_limit_message, work_limit_message,
};
