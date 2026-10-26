<?php

declare(strict_types=1);

namespace Seampact\Laravel;

/** What happens to an ETag the boundary did not set. */
enum FrameworkEtagMode: string
{
    case Strip = 'strip';
    case Keep = 'keep';
}
