<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\Name;
use Seampact\Ir\Naming\Identifier;
use Seampact\Ir\Naming\IrName;
use Seampact\Ir\Naming\NameSource;
use Seampact\Ir\Naming\NamingRole;
use Seampact\Ir\Naming\SplitName;

/** The PHP identifiers of IR names and wire names (ADR 0007 sections 4 and 5, PHP column). */
final class PhpNames
{
    private function __construct()
    {
    }

    /** @param list<string> $segments */
    public static function identifier(array $segments, NamingRole $role, ?int $status = null): string
    {
        return Identifier::of(new IrName($segments, $role, $status));
    }

    /** The member identifier of a wire name, or of its `codeName` when it has one; null when it yields no segment. */
    public static function memberIdentifier(string $wireName, ?Name $codeName = null): ?string
    {
        $segments = $codeName->segments ?? SplitName::segmentsOf($wireName, NameSource::Name);

        return $segments === null || $segments === [] ? null : self::identifier($segments, NamingRole::Member);
    }
}
