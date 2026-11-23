//! The options of a target that takes none yet.

use serde::Deserialize;

/// The options of a target that takes none: naming and style options wait.
///
/// `parse_options::<NoOptions>` accepts `{}` or no options, and refuses each key by name.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoOptions {}
