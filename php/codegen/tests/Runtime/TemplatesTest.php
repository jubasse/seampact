<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\Templates;

/** IR templates rendered over slots: a slot with no value is missing, and a missing member is left out or written as null. */
final class TemplatesTest extends TestCase
{
    public function testASlotReadsItsValueThroughItsPath(): void
    {
        $slot = ['kind' => 'slot', 'slot' => 'params', 'path' => ['a', 'b']];

        self::assertSame(7, Templates::render($slot, ['params' => (object) ['a' => ['b' => 7]]], false)->value);
        self::assertFalse(Templates::render($slot, ['params' => (object) ['a' => ['c' => 7]]], false)->present);
        self::assertFalse(Templates::render($slot, ['params' => 'text'], false)->present);
        self::assertFalse(Templates::render($slot, [], false)->present);
    }

    public function testASlotHoldingNullIsMissingButFalseAndZeroAreValues(): void
    {
        $slot = ['kind' => 'slot', 'slot' => 'value', 'path' => []];

        self::assertFalse(Templates::render($slot, ['value' => null], false)->present);
        self::assertFalse(Templates::render($slot, ['value' => false], false)->value);
        self::assertSame(0, Templates::render($slot, ['value' => 0], false)->value);
    }

    public function testATextWithAScalarSlotRendersItAndAnIntegerIsPrinted(): void
    {
        $text = ['kind' => 'text', 'parts' => [['kind' => 'text', 'text' => 'task '], ['kind' => 'slot', 'slot' => 'id', 'path' => []], ['kind' => 'text', 'text' => ' not found']]];

        self::assertSame('task 42 not found', Templates::render($text, ['id' => 42], false)->value);
        self::assertSame('task t-1 not found', Templates::render($text, ['id' => 't-1'], false)->value);
    }

    public function testATextWithAMissingOrNonScalarSlotIsMissingAsAWhole(): void
    {
        $text = ['kind' => 'text', 'parts' => [['kind' => 'text', 'text' => 'task '], ['kind' => 'slot', 'slot' => 'id', 'path' => []]]];

        self::assertFalse(Templates::render($text, [], false)->present);
        self::assertFalse(Templates::render($text, ['id' => null], false)->present);
        self::assertFalse(Templates::render($text, ['id' => ['a']], false)->present);
        self::assertFalse(Templates::render($text, ['id' => new \stdClass()], false)->present);
    }

    public function testAnObjectLeavesOutAMemberThatIsMissingUnlessNullsAreWritten(): void
    {
        $object = ['kind' => 'object', 'members' => [
            ['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'slot' => 'code', 'path' => []]],
            ['name' => ['kind' => 'text', 'text' => 'detail'], 'value' => ['kind' => 'slot', 'slot' => 'detail', 'path' => []]],
        ]];

        self::assertEquals((object) ['code' => 'x'], Templates::render($object, ['code' => 'x'], false)->value);
        self::assertEquals((object) ['code' => 'x', 'detail' => null], Templates::render($object, ['code' => 'x'], true)->value);
    }

    public function testAnObjectWithNoMemberRenderedIsMissing(): void
    {
        $object = ['kind' => 'object', 'members' => [
            ['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'slot' => 'code', 'path' => []]],
        ]];

        self::assertFalse(Templates::render($object, [], false)->present);
    }

    public function testAMemberNamedByASlotNeedsAStringOrIntegerName(): void
    {
        $object = ['kind' => 'object', 'members' => [
            ['name' => ['kind' => 'slot', 'slot' => 'key'], 'value' => ['kind' => 'literal', 'value' => 1]],
        ]];

        self::assertEquals((object) ['k' => 1], Templates::render($object, ['key' => 'k'], false)->value);
        self::assertEquals((object) ['5' => 1], Templates::render($object, ['key' => 5], false)->value);
        self::assertFalse(Templates::render($object, ['key' => ['k']], false)->present);
        self::assertFalse(Templates::render($object, [], false)->present);
    }

    public function testTheMergeSlotAddsItsObjectsMembersAndOverridesTheNamedOnes(): void
    {
        $object = ['kind' => 'object', 'merge' => 'extra', 'members' => [
            ['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'literal', 'value' => 'x']],
        ]];

        $rendered = Templates::render($object, ['extra' => (object) ['code' => 'y', 'more' => 1]], false);

        self::assertEquals((object) ['code' => 'y', 'more' => 1], $rendered->value);
    }

    public function testAnArrayDropsTheItemsThatAreMissing(): void
    {
        $array = ['kind' => 'array', 'items' => [
            ['kind' => 'slot', 'slot' => 'first', 'path' => []],
            ['kind' => 'slot', 'slot' => 'second', 'path' => []],
            ['kind' => 'literal', 'value' => 'end'],
        ]];

        self::assertSame(['a', 'end'], Templates::render($array, ['first' => 'a'], false)->value);
        self::assertSame([], Templates::render(['kind' => 'array', 'items' => []], [], false)->value);
    }

    public function testEachRendersItsTemplateOverEveryItemAndDropsTheMissingOnes(): void
    {
        $each = ['kind' => 'each', 'of' => 'issues', 'as' => ['kind' => 'slot', 'slot' => 'item', 'path' => ['pointer']]];

        $rendered = Templates::render($each, ['issues' => [['pointer' => '/a'], ['rule' => 'x'], ['pointer' => '/b']]], false);

        self::assertSame(['/a', '/b'], $rendered->value);
    }

    public function testEachOverSomethingThatIsNotAListIsMissing(): void
    {
        $each = ['kind' => 'each', 'of' => 'issues', 'as' => ['kind' => 'literal', 'value' => 1]];

        self::assertFalse(Templates::render($each, ['issues' => 'text'], false)->present);
        self::assertFalse(Templates::render($each, [], false)->present);
    }

    public function testATemplateOfAnUnknownKindIsALogicError(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("'mystery'");
        Templates::render(['kind' => 'mystery'], [], false);
    }
}
