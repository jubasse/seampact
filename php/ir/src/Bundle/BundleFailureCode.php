<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The failure codes of the tarball reader and the pinned-bundle check (ADR 0011), the codes of
 * `@seampact/spec/bundle`: every native verifier reports the same code for the same bundle.
 */
enum BundleFailureCode: string
{
    case ManifestMissing = 'bundle.manifest-missing';
    case ManifestTooLarge = 'bundle.manifest-too-large';
    case ManifestInvalid = 'bundle.manifest-invalid';
    case FileMissing = 'bundle.file-missing';
    case FileSize = 'bundle.file-size';
    case FileHash = 'bundle.file-hash';
    case FileUnlisted = 'bundle.file-unlisted';
    case FileType = 'bundle.file-type';
    case TooManyFiles = 'bundle.too-many-files';
    case TooLarge = 'bundle.too-large';
    case IntegrityMismatch = 'bundle.integrity-mismatch';
    case PinMissing = 'bundle.pin-missing';
    case PinMismatch = 'bundle.pin-mismatch';
    case IrUnreadable = 'bundle.ir-unreadable';
    case IrDeclaration = 'bundle.ir-declaration';
    case IrVersion = 'bundle.ir-version';
    case IrRevision = 'bundle.ir-revision';
    case IrInvalid = 'bundle.ir-invalid';
    case ArchiveTooLarge = 'bundle.archive-too-large';
    case ArchiveExtractedTooLarge = 'bundle.archive-extracted-too-large';
    case ArchiveTooManyEntries = 'bundle.archive-too-many-entries';
    case ArchiveInvalid = 'bundle.archive-invalid';
    case ArchiveEntryPath = 'bundle.archive-entry-path';
    case ArchiveEntryType = 'bundle.archive-entry-type';
    case ArchiveEntryDuplicate = 'bundle.archive-entry-duplicate';
}
