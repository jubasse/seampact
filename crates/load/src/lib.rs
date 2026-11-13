//! The load stage of the Rust port: the workspace readers, the load limits and their budget, the
//! load diagnostics, the include fragments, the YAML tree and the file store.
//!
//! [`LoadReader`] is the only way the loader reaches files ([`FsReader`] on disk, [`MemoryReader`]
//! in tests). Paths are root-relative strings with `/`: [`resolve_authored_path`] and
//! [`check_case`] decide whether an authored path stays inside its boundary and matches the disk.
//! The limits ([`LOAD_MAX_WORK`] and the others) are charged to one [`LoadBudget`]; a diagnostic is
//! reported through the [`Reporter`] under a [`LoadRule`]. [`FileStore`] reads each file once,
//! checks every authored path and parses each file into a [`yaml::YamlNode`] tree, reporting the
//! YAML pitfalls (P1 to P5, P9) and syntax errors as it does; [`resolve_plain_scalar`] is the
//! core schema's reading of a plain scalar. An [`Expander`] expands `$include`, `$file` and the file
//! form of `$ref` over those trees, one [`LayerBuild`] per layer file. [`merge_layers`] composes the layer builds of one api
//! into its raw tree and the origin of each leaf. [`load_workspace`] runs all of it from an entry
//! file: the raw trees, the files read, the sorted diagnostics and the fragments ([`LoadOutput`]).

mod budget;
mod compose;
mod expand;
mod fragments;
mod json;
mod layer_build;
mod limits;
mod loader;
mod pack_files;
mod paths;
pub mod positions;
mod reader;
mod report;
mod scalars;
mod source;
pub mod yaml;

pub use budget::{LoadBudget, load_work_of, utf16_length};
pub use compose::{Merged, merge_layers};
pub use expand::{Expander, MappingIndex, VisibleDeclaration, key_string};
pub use fragments::{LoadFragment, load_sort_fragments};
pub use json::{RESERVED_KEYS, is_reserved_key, show_value};
pub use layer_build::{FileRef, LayerBuild, RefUse};
pub use limits::{LOAD_MAX_DEPTH, LOAD_MAX_FILE_BYTES, LOAD_MAX_TEXT, LOAD_MAX_WORK};
pub use loader::{LoadOptions, LoadOutput, load_workspace};
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
pub use scalars::{PitfallPatterns, ResolvedScalar, ScalarPitfall, resolve_plain_scalar};
pub use source::{
    CheckedFile, FileKind, FileStore, OnMissing, ParsedFile, PathContext, ResolvedFile, node_span,
    pair_span,
};
