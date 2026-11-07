<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The file facts the Windows cache rule reads, injected so the rule is tested on any system. */
interface WindowsPathFacts
{
    /**
     * The facts of each path, by path; a missing path is absent from the result.
     *
     * @param list<string> $paths
     * @return array<string, WindowsPathFact>
     */
    public function of(array $paths): array;

    public function currentUserSid(): string;
}
