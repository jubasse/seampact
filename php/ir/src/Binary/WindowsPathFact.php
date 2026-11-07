<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** What the Windows cache rule reads of one path: a reparse point, and the SIDs its ACL lets write. */
final readonly class WindowsPathFact
{
    /** @param list<string> $writerSids the accounts an allow entry grants any write right */
    public function __construct(public bool $isReparsePoint, public array $writerSids)
    {
    }
}
