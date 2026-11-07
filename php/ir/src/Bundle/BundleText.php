<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Read\RefusalText;

/** Pointers and problem lists in a bundle message; untrusted text is quoted by `Https\UntrustedText`. */
final class BundleText
{
    private function __construct()
    {
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
