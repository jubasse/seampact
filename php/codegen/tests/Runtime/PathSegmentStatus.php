<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/** A string-backed enum whose value holds a space, written by the URL builders as one encoded segment. */
enum PathSegmentStatus: string
{
    case InReview = 'in review';
}
