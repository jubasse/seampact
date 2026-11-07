<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** The PCRE form of a contract pattern (ADR 0003 `pattern`), as the generated PHP code writes it. */
final class PcrePattern
{
    /** The delimiters tried in order; a pattern holding every one of them is refused by name. */
    public const DELIMITERS = ['/', '#', '~', '%', '!', '@', ';', ','];

    private function __construct()
    {
    }

    /** The normalised pattern between the first delimiter it does not hold, then `$modifiers`; null when it holds all. */
    public static function of(string $normalized, string $modifiers): ?string
    {
        foreach (self::DELIMITERS as $delimiter) {
            if (!str_contains($normalized, $delimiter)) {
                return $delimiter . $normalized . $delimiter . $modifiers;
            }
        }

        return null;
    }

    /** Refuses a pattern that holds every delimiter, as `pattern.delimiter.unsupported` at `$at`. */
    public static function refuse(Refusals $refusals, IrPlace $at): void
    {
        $refusals->waiting('pattern.delimiter', 'A pattern holding every PCRE delimiter the target uses (' . implode(' ', self::DELIMITERS) . ')', $at, Delivery::Consumer);
    }
}
