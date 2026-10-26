<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** What the POSIX cache rule reads of one path, from `lstat`: a link is never followed. */
final readonly class PathFact
{
    public function __construct(public bool $isLink, public int $ownerUid, public int $groupId, public int $mode)
    {
    }
}
