<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** An open array or object of a parsed document: its children left to visit and the segment being visited. */
final class OpenElement
{
    public string $segment = '';

    /** @param \Iterator<int|string, mixed> $children */
    public function __construct(public readonly \Iterator $children)
    {
    }
}
