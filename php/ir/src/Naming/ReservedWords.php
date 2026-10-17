<?php

// Generated from packages/core/spec/vectors/naming/reserved-words.json by scripts/ir-models. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/** The reserved and shadowed names of PHP (ADR 0007 section 5). */
final class ReservedWords
{
    public static function caseInsensitive(): bool
    {
        return true;
    }

    /** @return list<string> */
    public static function keywords(): array
    {
        return [];
    }

    /** @return list<string> */
    public static function types(): array
    {
        return [
            'abstract', 'and', 'array', 'as', 'bool', 'break',
            'callable', 'case', 'catch', 'class', 'clone', 'const',
            'continue', 'declare', 'default', 'die', 'do', 'echo',
            'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach',
            'endif', 'endswitch', 'endwhile', 'enum', 'eval', 'exit',
            'extends', 'false', 'final', 'finally', 'float', 'fn',
            'for', 'foreach', 'function', 'global', 'goto', 'if',
            'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'int',
            'interface', 'isset', 'iterable', 'list', 'match', 'mixed',
            'namespace', 'never', 'new', 'null', 'object', 'or',
            'parent', 'print', 'private', 'protected', 'public', 'readonly',
            'require', 'require_once', 'return', 'self', 'static', 'string',
            'switch', 'throw', 'trait', 'true', 'try', 'unset',
            'use', 'var', 'void', 'while', 'xor', 'yield',
        ];
    }

    /** @return list<string> */
    public static function members(): array
    {
        return [
            'this',
        ];
    }

    /** @return list<string> */
    public static function enumMembers(): array
    {
        return [
            'class',
        ];
    }
}
