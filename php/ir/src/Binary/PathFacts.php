<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The file facts the POSIX cache rule reads, injected so the rule is tested without a second user. */
interface PathFacts
{
    /** The facts of `$path`, or null when nothing is there. */
    public function of(string $path): ?PathFact;

    public function currentUid(): int;

    /** Whether `$groupId` is the private group of `$ownerUid`: the owner's primary group, with no other member. */
    public function isPrivateGroup(int $groupId, int $ownerUid): bool;

    /** The real path of an existing directory, links resolved. */
    public function realDirectory(string $path): string;
}
