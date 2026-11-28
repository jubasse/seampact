//! Whether one resolved path lies under another, by their text: the config's paths are not real
//! paths. The checks live in `seampact-paths`.

pub(crate) use seampact_paths::is_inside_or_equal;
pub use seampact_paths::is_strictly_inside;
