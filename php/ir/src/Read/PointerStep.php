<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/**
 * A JSON Pointer as a link to its parent: a step costs one node, and the string is built only for a refusal, so
 * a long key is not copied for every node below it. The root document is `null`.
 */
final readonly class PointerStep
{
    public function __construct(public ?PointerStep $parent, public string $segment)
    {
    }

    public static function toPointer(?PointerStep $step): string
    {
        $segments = [];
        for ($current = $step; $current !== null; $current = $current->parent) {
            $segments[] = '/' . RefusalText::escapePointerSegment($current->segment);
        }

        return implode('', array_reverse($segments));
    }
}
