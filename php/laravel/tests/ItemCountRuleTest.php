<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Laravel\Runtime\InputTree;
use Seampact\Laravel\Runtime\ItemCountRule;
use Seampact\Laravel\Runtime\Position;

/** A list member's item count against its declared bounds. */
final class ItemCountRuleTest extends TestCase
{
    /** @return iterable<string, array{mixed, ?int, ?int, ?string}> */
    public static function counts(): iterable
    {
        yield 'at the minimum' => [[1, 2], 2, 4, null];
        yield 'at the maximum' => [[1, 2, 3, 4], 2, 4, null];
        yield 'below the minimum' => [[1], 2, 4, 'minItems'];
        yield 'an empty list under a minimum' => [[], 1, null, 'minItems'];
        yield 'above the maximum' => [[1, 2, 3, 4, 5], 2, 4, 'maxItems'];
        yield 'an empty list under no bound' => [[], null, null, null];
        yield 'a non-list value is left to the type rule' => ['text', 1, 2, null];
        yield 'null is left to the type rule' => [null, 1, 2, null];
    }

    #[DataProvider('counts')]
    public function testTheCountIsHeldToItsBounds(mixed $value, ?int $minItems, ?int $maxItems, ?string $expectedRule): void
    {
        $tree = InputTree::withBody([], [], [], (object) ['tags' => $value]);

        (new ItemCountRule($tree, Position::Member, $minItems, $maxItems))->validate('body.tags', $value, (new RecordedFailure())->callback());

        $rules = array_map(static fn ($issue): string => $issue->rule, $tree->issues());
        self::assertSame($expectedRule === null ? [] : [$expectedRule], $rules);
    }
}
