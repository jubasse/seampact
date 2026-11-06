<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** The 200 result of `legacyNote` in `VersionedNotesContract`: an opaque note. */
final class LegacyNoteReply
{
    public function __construct(public readonly mixed $body)
    {
    }
}
