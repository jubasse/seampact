//! Why a bundle is refused, with the fix.

/// The code of a bundle failure: the verifier's, the archive reader's and the writer's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BundleFailureCode {
    /// `bundle.manifest-missing`.
    ManifestMissing,
    /// `bundle.manifest-too-large`.
    ManifestTooLarge,
    /// `bundle.manifest-invalid`.
    ManifestInvalid,
    /// `bundle.file-missing`.
    FileMissing,
    /// `bundle.file-size`.
    FileSize,
    /// `bundle.file-hash`.
    FileHash,
    /// `bundle.file-unlisted`.
    FileUnlisted,
    /// `bundle.file-type`.
    FileType,
    /// `bundle.too-many-files`.
    TooManyFiles,
    /// `bundle.too-large`.
    TooLarge,
    /// `bundle.integrity-mismatch`.
    IntegrityMismatch,
    /// `bundle.pin-missing`.
    PinMissing,
    /// `bundle.pin-mismatch`.
    PinMismatch,
    /// `bundle.ir-unreadable`.
    IrUnreadable,
    /// `bundle.ir-declaration`.
    IrDeclaration,
    /// `bundle.ir-version`.
    IrVersion,
    /// `bundle.ir-revision`.
    IrRevision,
    /// `bundle.ir-invalid`.
    IrInvalid,
    /// `bundle.archive-too-large`.
    ArchiveTooLarge,
    /// `bundle.archive-invalid`.
    ArchiveInvalid,
    /// `bundle.archive-entry-path`.
    ArchiveEntryPath,
    /// `bundle.archive-entry-type`.
    ArchiveEntryType,
    /// `bundle.archive-entry-duplicate`.
    ArchiveEntryDuplicate,
    /// `bundle.archive-too-many-entries`.
    ArchiveTooManyEntries,
    /// `bundle.archive-extracted-too-large`.
    ArchiveExtractedTooLarge,
    /// `bundle.compile-failed`.
    CompileFailed,
    /// `bundle.contract-missing`.
    ContractMissing,
    /// `bundle.label-invalid`.
    LabelInvalid,
    /// `bundle.file-outside-root`.
    FileOutsideRoot,
    /// `bundle.path-unportable`.
    PathUnportable,
    /// `bundle.pack-unreadable`.
    PackUnreadable,
    /// `bundle.imports-unsupported`.
    ImportsUnsupported,
    /// `bundle.output-not-empty`.
    OutputNotEmpty,
}

impl BundleFailureCode {
    /// Every code, in the order the TypeScript lists them.
    pub const ALL: &'static [Self] = &[
        Self::ManifestMissing,
        Self::ManifestTooLarge,
        Self::ManifestInvalid,
        Self::FileMissing,
        Self::FileSize,
        Self::FileHash,
        Self::FileUnlisted,
        Self::FileType,
        Self::TooManyFiles,
        Self::TooLarge,
        Self::IntegrityMismatch,
        Self::PinMissing,
        Self::PinMismatch,
        Self::IrUnreadable,
        Self::IrDeclaration,
        Self::IrVersion,
        Self::IrRevision,
        Self::IrInvalid,
        Self::ArchiveTooLarge,
        Self::ArchiveInvalid,
        Self::ArchiveEntryPath,
        Self::ArchiveEntryType,
        Self::ArchiveEntryDuplicate,
        Self::ArchiveTooManyEntries,
        Self::ArchiveExtractedTooLarge,
        Self::CompileFailed,
        Self::ContractMissing,
        Self::LabelInvalid,
        Self::FileOutsideRoot,
        Self::PathUnportable,
        Self::PackUnreadable,
        Self::ImportsUnsupported,
        Self::OutputNotEmpty,
    ];

    /// The code as the manifest vectors and the failure files write it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ManifestMissing => "bundle.manifest-missing",
            Self::ManifestTooLarge => "bundle.manifest-too-large",
            Self::ManifestInvalid => "bundle.manifest-invalid",
            Self::FileMissing => "bundle.file-missing",
            Self::FileSize => "bundle.file-size",
            Self::FileHash => "bundle.file-hash",
            Self::FileUnlisted => "bundle.file-unlisted",
            Self::FileType => "bundle.file-type",
            Self::TooManyFiles => "bundle.too-many-files",
            Self::TooLarge => "bundle.too-large",
            Self::IntegrityMismatch => "bundle.integrity-mismatch",
            Self::PinMissing => "bundle.pin-missing",
            Self::PinMismatch => "bundle.pin-mismatch",
            Self::IrUnreadable => "bundle.ir-unreadable",
            Self::IrDeclaration => "bundle.ir-declaration",
            Self::IrVersion => "bundle.ir-version",
            Self::IrRevision => "bundle.ir-revision",
            Self::IrInvalid => "bundle.ir-invalid",
            Self::ArchiveTooLarge => "bundle.archive-too-large",
            Self::ArchiveInvalid => "bundle.archive-invalid",
            Self::ArchiveEntryPath => "bundle.archive-entry-path",
            Self::ArchiveEntryType => "bundle.archive-entry-type",
            Self::ArchiveEntryDuplicate => "bundle.archive-entry-duplicate",
            Self::ArchiveTooManyEntries => "bundle.archive-too-many-entries",
            Self::ArchiveExtractedTooLarge => "bundle.archive-extracted-too-large",
            Self::CompileFailed => "bundle.compile-failed",
            Self::ContractMissing => "bundle.contract-missing",
            Self::LabelInvalid => "bundle.label-invalid",
            Self::FileOutsideRoot => "bundle.file-outside-root",
            Self::PathUnportable => "bundle.path-unportable",
            Self::PackUnreadable => "bundle.pack-unreadable",
            Self::ImportsUnsupported => "bundle.imports-unsupported",
            Self::OutputNotEmpty => "bundle.output-not-empty",
        }
    }
}

/// Why a bundle is refused, with the fix.
#[derive(Debug, Clone, PartialEq)]
pub struct BundleFailure {
    /// The `code` member.
    pub code: BundleFailureCode,
    /// The `message` member.
    pub message: String,
    /// The `fix` member.
    pub fix: String,
    /// The bundle path (or archive entry, or source file) the failure is about.
    pub file: Option<String>,
    /// What was expected (the manifest, the pin), when two values differ.
    pub expected: Option<String>,
    /// What was found, when two values differ.
    pub actual: Option<String>,
}

impl BundleFailure {
    /// A failure with no file and no pair of values.
    #[must_use]
    pub fn new(code: BundleFailureCode, message: String, fix: &str) -> Self {
        Self {
            code,
            message,
            fix: fix.to_owned(),
            file: None,
            expected: None,
            actual: None,
        }
    }

    /// The same failure, about `file`.
    #[must_use]
    pub fn about(mut self, file: &str) -> Self {
        self.file = Some(file.to_owned());

        self
    }

    /// The same failure, with the value expected.
    #[must_use]
    pub fn expecting(mut self, expected: String) -> Self {
        self.expected = Some(expected);

        self
    }

    /// The same failure, with the value found.
    #[must_use]
    pub fn finding(mut self, actual: String) -> Self {
        self.actual = Some(actual);

        self
    }
}
