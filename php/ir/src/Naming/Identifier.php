<?php

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/** The PHP identifier of a name (ADR 0007 sections 4 and 5): the `php` column of the shared vectors. */
final class Identifier
{
    private const ESCAPE = '_';

    /**
     * The identifier of `$name`: the segments and the suffix words joined in the style of the role, a leading `_` when
     * the first word starts with a digit, then a trailing `_` when the result is a reserved word or a shadowed name.
     *
     * @throws \InvalidArgumentException the name has no segment and no suffix word
     */
    public static function of(IrName $name): string
    {
        $words = $name->words();

        if ($words === []) {
            throw new \InvalidArgumentException("a {$name->role->value} name without segment has no identifier");
        }

        $joined = self::isCamel($name->role) ? self::camelCased($words) : self::pascalCased($words);
        $digitSafe = ctype_digit($joined[0]) ? '_' . $joined : $joined;

        return self::isReserved($digitSafe, $name->role) ? $digitSafe . self::ESCAPE : $digitSafe;
    }

    /**
     * The string of an operation id for `$segments`: pure casing, with no reserved-word escape and no digit escape,
     * because the id is the same string in the IR, in OpenAPI and in `relays` (ADR 0007 section 3).
     *
     * @param list<string> $segments
     * @throws \InvalidArgumentException no segment, or a segment outside `[a-z0-9]+`
     */
    public static function operationId(array $segments, OperationIdCase $idCase = OperationIdCase::Camel): string
    {
        if ($segments === []) {
            throw new \InvalidArgumentException('an operation id needs at least one segment');
        }

        IrName::assertSegments($segments);

        return $idCase === OperationIdCase::Snake ? implode('_', $segments) : self::camelCased($segments);
    }

    private static function isCamel(NamingRole $role): bool
    {
        return $role === NamingRole::Operation || $role === NamingRole::Member;
    }

    /** @param non-empty-list<string> $words */
    private static function camelCased(array $words): string
    {
        return $words[0] . self::pascalCased(array_slice($words, 1));
    }

    /** @param list<string> $words */
    private static function pascalCased(array $words): string
    {
        return implode('', array_map(ucfirst(...), $words));
    }

    private static function isReserved(string $identifier, NamingRole $role): bool
    {
        $key = ReservedWords::caseInsensitive() ? strtolower($identifier) : $identifier;

        if (in_array($key, ReservedWords::keywords(), true)) {
            return true;
        }

        return match (true) {
            $role->isType() => in_array($key, ReservedWords::types(), true),
            $role === NamingRole::Member || $role === NamingRole::Operation => in_array($key, ReservedWords::members(), true),
            default => in_array($key, ReservedWords::enumMembers(), true),
        };
    }
}
