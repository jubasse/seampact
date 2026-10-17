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

        $joined = self::join($words, self::isCamel($name->role));
        $digitSafe = ctype_digit($joined[0]) ? '_' . $joined : $joined;

        return self::isReserved($digitSafe, $name->role) ? $digitSafe . self::ESCAPE : $digitSafe;
    }

    /**
     * The string of an operation id for `$segments`: pure casing, with no reserved-word escape and no digit escape,
     * because the id is the same string in the IR, in OpenAPI and in `relays` (ADR 0007 section 3).
     *
     * @param list<string> $segments
     * @throws \InvalidArgumentException no segment
     */
    public static function operationId(array $segments, OperationIdCase $idCase = OperationIdCase::Camel): string
    {
        if ($segments === []) {
            throw new \InvalidArgumentException('an operation id needs at least one segment');
        }

        return $idCase === OperationIdCase::Snake ? implode('_', $segments) : self::join($segments, true);
    }

    private static function isCamel(NamingRole $role): bool
    {
        return $role === NamingRole::Operation || $role === NamingRole::Member;
    }

    /** @param list<string> $words */
    private static function join(array $words, bool $camel): string
    {
        $joined = '';

        foreach ($words as $index => $word) {
            $joined .= $camel && $index === 0 ? $word : ucfirst($word);
        }

        return $joined;
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
