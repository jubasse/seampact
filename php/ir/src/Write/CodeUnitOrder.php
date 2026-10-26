<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/**
 * Code-unit order of two UTF-8 strings, as JavaScript compares strings (ADR 0015 "Generate is pure"), never a
 * locale's. Byte order is code-point order, which differs from it only between a character past U+FFFF (two
 * UTF-16 surrogates, D800 to DFFF) and one from U+E000 to U+FFFF.
 */
final class CodeUnitOrder
{
    private const SUPPLEMENTARY_START = 0x10000;

    private const HIGH_SURROGATE_START = 0xD800;

    private const LOW_SURROGATE_START = 0xDC00;

    private const SURROGATE_BITS = 10;

    private const SURROGATE_MASK = 0x3FF;

    private function __construct()
    {
    }

    public static function compare(string $left, string $right): int
    {
        $leftUnits = self::units($left);
        $rightUnits = self::units($right);
        $shared = min(count($leftUnits), count($rightUnits));

        for ($index = 0; $index < $shared; $index++) {
            if ($leftUnits[$index] !== $rightUnits[$index]) {
                return $leftUnits[$index] <=> $rightUnits[$index];
            }
        }

        return count($leftUnits) <=> count($rightUnits);
    }

    /** @return list<int> the UTF-16 code units of `$text` */
    private static function units(string $text): array
    {
        $characters = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
        if ($characters === false) {
            throw new \InvalidArgumentException('seampact: a path to order is not UTF-8; `GeneratedPaths::checked` refuses such a path first.');
        }

        $units = [];
        foreach ($characters as $character) {
            $codePoint = self::codePoint($character);
            if ($codePoint < self::SUPPLEMENTARY_START) {
                $units[] = $codePoint;
                continue;
            }

            $offset = $codePoint - self::SUPPLEMENTARY_START;
            $units[] = self::HIGH_SURROGATE_START + ($offset >> self::SURROGATE_BITS);
            $units[] = self::LOW_SURROGATE_START + ($offset & self::SURROGATE_MASK);
        }

        return $units;
    }

    private static function codePoint(string $character): int
    {
        $bytes = array_map(ord(...), str_split($character));

        return match (count($bytes)) {
            1 => $bytes[0],
            2 => (($bytes[0] & 0x1F) << 6) | ($bytes[1] & 0x3F),
            3 => (($bytes[0] & 0x0F) << 12) | (($bytes[1] & 0x3F) << 6) | ($bytes[2] & 0x3F),
            default => (($bytes[0] & 0x07) << 18) | (($bytes[1] & 0x3F) << 12) | (($bytes[2] & 0x3F) << 6) | ($bytes[3] & 0x3F),
        };
    }
}
