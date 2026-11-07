<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** What the boundary does with an ETag the framework sets on a contract reply: strip it, or keep it. */
enum FrameworkEtagMode: string
{
    case Strip = 'strip';
    case Keep = 'keep';
}
