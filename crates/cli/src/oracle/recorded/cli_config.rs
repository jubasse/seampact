//! The recorded calls of the CLI config readers: the brief that ports each recorded function reads
//! its arguments and converts its result here.

use camino::Utf8Path;
use seampact_oracle::{RecordedAnswer, RecordedToolCall, SubjectAnswer};

/// Replays a recorded call of the CLI config readers on the case root; not ported yet.
pub(super) fn cli_config_answer(
    _call: &RecordedToolCall,
    _root: &Utf8Path,
) -> SubjectAnswer<RecordedAnswer> {
    SubjectAnswer::NotPorted
}
