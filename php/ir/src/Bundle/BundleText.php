<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Read\RefusalText;

/**
 * Untrusted text in a bundle message, as the compiler's `quote` prints it: in single quotes, at most 80 code
 * points, the C0, DEL and C1 controls, the bidi controls and the line and paragraph separators as \uXXXX.
 */
final class BundleText
{
    private const QUOTE_LIMIT = 80;

    private const UNSAFE_CODE_POINTS = '/[\x{0}-\x{1f}\x{7f}-\x{9f}\x{61c}\x{200e}\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{2028}\x{2029}]/u';

    private const REPLACEMENT_CHARACTER = "\u{FFFD}";

    private function __construct()
    {
    }

    public static function quoted(string $value): string
    {
        $text = self::utf8OrReplaced($value);
        $codePoints = preg_split('//u', $text, -1, PREG_SPLIT_NO_EMPTY);
        $codePoints = $codePoints === false ? [] : $codePoints;
        $kept = implode('', array_slice($codePoints, 0, self::QUOTE_LIMIT));
        $shown = preg_replace_callback(
            self::UNSAFE_CODE_POINTS,
            static fn (array $match): string => sprintf('\\u%04X', self::codePointOf($match[0])),
            $kept,
        );

        return "'" . ($shown ?? $kept) . (count($codePoints) > self::QUOTE_LIMIT ? '…' : '') . "'";
    }

    /** `$value` when it is UTF-8; otherwise each byte outside ASCII as U+FFFD, which no bundle path holds. */
    public static function utf8OrReplaced(string $value): string
    {
        if (self::isUtf8($value)) {
            return $value;
        }

        return preg_replace('/[\x80-\xff]/', self::REPLACEMENT_CHARACTER, $value) ?? '';
    }

    public static function isUtf8(string $value): bool
    {
        return preg_match('//u', $value) === 1;
    }

    // The unsafe code points are all in the Basic Multilingual Plane: one to three UTF-8 bytes.
    private static function codePointOf(string $character): int
    {
        $bytes = array_map(ord(...), str_split($character));

        return match (count($bytes)) {
            1 => $bytes[0],
            2 => (($bytes[0] & 0x1f) << 6) | ($bytes[1] & 0x3f),
            default => (($bytes[0] & 0x0f) << 12) | (($bytes[1] & 0x3f) << 6) | ($bytes[2] & 0x3f),
        };
    }

    /** The JSON Pointer of `$member` below `$pointer`. */
    public static function pointerBelow(string $pointer, string $member): string
    {
        return $pointer . '/' . RefusalText::escapePointerSegment($member);
    }

    /**
     * At most `$limit` problems joined, then how many more there are.
     *
     * @param list<string> $problems
     */
    public static function listedProblems(array $problems, int $limit): string
    {
        $listed = implode('; ', array_slice($problems, 0, $limit));
        $more = count($problems) - $limit;

        return $more > 0 ? "{$listed}; and {$more} more" : $listed;
    }
}
