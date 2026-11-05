<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Schemas;

/**
 * The schema 'RolesParams'.
 */
final readonly class RolesParams
{
    /**
     * @param list<Role> $allowed
     */
    public function __construct(
        public array $allowed,
    ) {
    }
}
