<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The file facts the POSIX cache rule reads, injected so the rule is tested without a second user. */
interface PathFacts
{
    /** The facts of `$path`, or null when nothing is there. */
    public function of(string $path): ?PathFact;

    public function currentUid(): int;

    /** Whether the system account files prove `$groupId` private to `$ownerUid` (`SystemAccounts`). */
    public function isPrivateGroup(int $groupId, int $ownerUid): bool;
}
