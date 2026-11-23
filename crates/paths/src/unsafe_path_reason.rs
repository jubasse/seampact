//! Why a path is not a relative POSIX path that stays inside its root.

use std::fmt;

/// Why a path could leave its root or is no portable relative path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum UnsafePathReason {
    /// The path is the empty string.
    Empty,
    /// The path holds a `\`.
    Backslash,
    /// The path starts with `/` or with a drive prefix such as `C:`.
    AbsolutePrefix,
    /// The path holds a NUL character.
    Nul,
    /// A segment between two `/` is empty, `.` or `..`.
    EmptyOrDotSegment,
}

/// The order of `generated-paths.ts#unsafePathReason`, which names the first reason that holds.
const OUTPUT_PATH_ORDER: [UnsafePathReason; 5] = [
    UnsafePathReason::Empty,
    UnsafePathReason::Backslash,
    UnsafePathReason::AbsolutePrefix,
    UnsafePathReason::Nul,
    UnsafePathReason::EmptyOrDotSegment,
];

/// The order of the bundle tarball reader, which names a NUL before a backslash.
const UNTRUSTED_ENTRY_ORDER: [UnsafePathReason; 5] = [
    UnsafePathReason::Empty,
    UnsafePathReason::Nul,
    UnsafePathReason::Backslash,
    UnsafePathReason::AbsolutePrefix,
    UnsafePathReason::EmptyOrDotSegment,
];

impl UnsafePathReason {
    /// The reason as the generated-file writer words it, after "and": `it is empty`.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "it is empty",
            Self::Backslash => "it contains a backslash; paths use '/'",
            Self::AbsolutePrefix => "it has an absolute prefix",
            Self::Nul => "it contains a NUL character",
            Self::EmptyOrDotSegment => "it has an empty, '.' or '..' segment",
        }
    }

    fn holds_for(self, path: &str) -> bool {
        match self {
            Self::Empty => path.is_empty(),
            Self::Backslash => path.contains('\\'),
            Self::AbsolutePrefix => path.starts_with('/') || has_drive_prefix(path),
            Self::Nul => path.contains('\0'),
            Self::EmptyOrDotSegment => path
                .split('/')
                .any(|segment| matches!(segment, "" | "." | "..")),
        }
    }
}

impl fmt::Display for UnsafePathReason {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// `/^[A-Za-z]:/`: an ASCII letter, then a colon.
fn has_drive_prefix(path: &str) -> bool {
    let mut characters = path.chars();

    characters
        .next()
        .is_some_and(|letter| letter.is_ascii_alphabetic())
        && characters.next() == Some(':')
}

fn first_reason(path: &str, order: &[UnsafePathReason]) -> Option<UnsafePathReason> {
    order.iter().copied().find(|reason| reason.holds_for(path))
}

/// The first reason the output path is unsafe, in the order of the generated-file writer.
pub(crate) fn output_path_problem(path: &str) -> Option<UnsafePathReason> {
    first_reason(path, &OUTPUT_PATH_ORDER)
}

/// The first reason a tarball or git tree entry path is unsafe, in the bundle readers' order:
/// empty, NUL, backslash, absolute, then an empty, `.` or `..` segment. Each reader words the
/// reason itself; the portable bundle path rule comes after this one.
#[must_use]
pub fn untrusted_entry_problem(path: &str) -> Option<UnsafePathReason> {
    first_reason(path, &UNTRUSTED_ENTRY_ORDER)
}
