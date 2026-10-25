<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** Why a signature failed; the authenticate hook answers its declared 401 for each of them. */
enum SignatureFailure: string
{
    case NoSecret = 'no-secret';
    case TimestampMissing = 'timestamp-missing';
    case TimestampMalformed = 'timestamp-malformed';
    case TimestampOutsideTolerance = 'timestamp-outside-tolerance';
    case SignatureMismatch = 'signature-mismatch';
}
