<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/**
 * The codes of `checkIrSupport`, then two codes local to the native readers: an unknown tag or value of a
 * must-act definition, and a document nested past the depth they read.
 */
enum IrRefusalCode: string
{
    case VersionUnsupported = 'ir.version.unsupported';
    case RevisionMismatch = 'ir.revision.mismatch';
    case KindUnsupported = 'ir.kind.unsupported';
    case FeatureUnsupported = 'ir.feature.unsupported';
    case SupportMalformed = 'ir.support.malformed';
    case MustActUnknown = 'ir.must-act.unknown';
    case NestingTooDeep = 'ir.nesting.too-deep';
}
