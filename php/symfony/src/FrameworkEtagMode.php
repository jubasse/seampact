<?php

declare(strict_types=1);

namespace Seampact\Symfony;

/** What the boundary does with an ETag Symfony sets on a contract reply: strip it, or keep it. */
enum FrameworkEtagMode: string
{
    case Strip = 'strip';
    case Keep = 'keep';
}
