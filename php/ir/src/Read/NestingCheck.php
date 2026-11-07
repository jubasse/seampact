<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/**
 * The deepest JSON nesting a reader reads: each array or object is one level, the root one is level 1 (the same
 * count as the Kotlin reader). The deepest real IR is a few dozen levels. The parse, the checks and the
 * hydration that follow recurse per level, so the whole document is measured first, without recursion.
 */
final class NestingCheck
{
    public const MAX_NESTING_DEPTH = 256;

    /**
     * Returns the refusal of a JSON text nested past the bound, or null. One linear scan of the text, before it
     * is parsed (`json_decode` gives no pointer): it counts the arrays and objects open outside strings and
     * stops at the first one past the bound. It counts every array and object as written, a duplicate key's
     * included, so a text too deep is refused even when it is also malformed; a shallow malformed text is left to
     * the parser.
     */
    public static function checkText(string $text): ?IrRefusal
    {
        $pointer = (new TextNestingScan($text))->firstPointerPastBound();

        return $pointer === null ? null : self::refusal($pointer);
    }

    /** The same check on a document already parsed, by an explicit stack instead of recursion. */
    public static function checkDocument(mixed $document): ?IrRefusal
    {
        $pointer = self::firstPointerPastBound($document);

        return $pointer === null ? null : self::refusal($pointer);
    }

    private static function refusal(string $pointer): IrRefusal
    {
        $reached = self::MAX_NESTING_DEPTH + 1;

        return new IrRefusal(
            IrRefusalCode::NestingTooDeep,
            $pointer,
            (string) $reached,
            [(string) self::MAX_NESTING_DEPTH],
            null,
            sprintf(
                'The IR nests %d levels deep at %s, past the %d this reader reads: it refuses the whole document rather than overflow its stack.',
                $reached,
                RefusalText::inMessage($pointer),
                self::MAX_NESTING_DEPTH,
            ),
        );
    }

    // Visits the containers depth first in document order, as the text scan meets them.
    private static function firstPointerPastBound(mixed $document): ?string
    {
        $root = self::childrenOf($document);
        if ($root === null) {
            return null;
        }

        /** @var list<OpenElement> $open */
        $open = [new OpenElement($root)];
        while ($open !== []) {
            $container = $open[count($open) - 1];
            if (!$container->children->valid()) {
                array_pop($open);

                continue;
            }

            $segment = (string) $container->children->key();
            $child = $container->children->current();
            $container->children->next();
            $container->segment = $segment;

            $grandchildren = self::childrenOf($child);
            if ($grandchildren === null) {
                continue;
            }
            if (count($open) === self::MAX_NESTING_DEPTH) {
                return self::pointerOf($open);
            }
            $open[] = new OpenElement($grandchildren);
        }

        return null;
    }

    /** @return \Iterator<int|string, mixed>|null */
    private static function childrenOf(mixed $element): ?\Iterator
    {
        if (is_array($element)) {
            return new \ArrayIterator($element);
        }

        return $element instanceof \stdClass ? new \ArrayIterator(get_object_vars($element)) : null;
    }

    /** @param list<OpenElement> $open */
    private static function pointerOf(array $open): string
    {
        $pointer = '';
        foreach ($open as $container) {
            $pointer .= '/' . RefusalText::escapePointerSegment($container->segment);
        }

        return $pointer;
    }
}
