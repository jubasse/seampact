<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Ir\Model\Docs;

/** The PHPDoc text of the contract's docs: the summary, then the description after a blank line. */
final class DocComments
{
    private function __construct()
    {
    }

    public static function of(?Docs $docs, string $fallback): string
    {
        $parts = array_values(array_filter([$docs?->summary, $docs?->description], static fn (?string $text): bool => $text !== null && trim($text) !== ''));

        // `*/` inside the text would close the PHPDoc early.
        return str_replace('*/', '* /', $parts === [] ? $fallback : implode("\n\n", $parts));
    }
}
