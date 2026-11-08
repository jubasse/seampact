<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\DateTimeVectors;
use Seampact\Laravel\Runtime\BlankStrings;
use Seampact\Laravel\Runtime\ContractIssue;
use Seampact\Laravel\Runtime\FormatRule;
use Seampact\Laravel\Runtime\InputTree;
use Seampact\Laravel\Runtime\Position;

/** The `date-time` and `uuid` format rules run on a decoded body member, as Laravel's validator runs them. */
final class FormatRuleTest extends TestCase
{
    private const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

    /** @return iterable<string, array{string, bool}> */
    public static function dateTimes(): iterable
    {
        return DateTimeVectors::all();
    }

    #[DataProvider('dateTimes')]
    public function testADateTimeIsAcceptedOnlyWhenItIsAnRfc3339InstantWithAnOffset(string $value, bool $accepted): void
    {
        self::assertSame($accepted ? [] : [['body', '/at', 'format']], self::issues(FormatRule::DATE_TIME, BlankStrings::Every, $value));
    }

    public function testAUuidIsHyphenatedHexOfTheRightGroups(): void
    {
        self::assertSame([], self::issues(FormatRule::UUID, BlankStrings::Every, self::UUID));
        self::assertSame([['body', '/at', 'format']], self::issues(FormatRule::UUID, BlankStrings::Every, 'not-a-uuid'));
        self::assertSame([['body', '/at', 'format']], self::issues(FormatRule::UUID, BlankStrings::Every, self::UUID . "\n"));
    }

    public function testUnderBlankOnlyOnlyABlankStringIsChecked(): void
    {
        self::assertSame([['body', '/at', 'format']], self::issues(FormatRule::UUID, BlankStrings::BlankOnly, '  '));
        self::assertSame([['body', '/at', 'format']], self::issues(FormatRule::UUID, BlankStrings::BlankOnly, ''));
        self::assertSame([], self::issues(FormatRule::UUID, BlankStrings::BlankOnly, 'not-a-uuid'), 'Laravel\'s own uuid rule judges it.');
    }

    public function testAValueThatIsNotAStringIsLeftToTheTypeRule(): void
    {
        self::assertSame([], self::issues(FormatRule::DATE_TIME, BlankStrings::Every, 12));
        self::assertSame([], self::issues(FormatRule::DATE_TIME, BlankStrings::Every, null));
    }

    public function testAnAbsentMemberIsLeftToTheRequiredRule(): void
    {
        $tree = InputTree::withBody([], [], [], (object) []);
        $rule = new FormatRule($tree, Position::Member, FormatRule::DATE_TIME, BlankStrings::Every);

        $rule->validate('body.at', null, static function (): never {
            self::fail('An absent member must not fail the format.');
        });

        self::assertSame([], $tree->issues());
    }

    public function testAnUnknownFormatIsALogicError(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("unknown format 'time'");
        self::issues('time', BlankStrings::Every, '10:00');
    }

    /** @return list<array{string, string, string}> the issues recorded as part, pointer and rule */
    private static function issues(string $format, BlankStrings $checked, mixed $value): array
    {
        $tree = InputTree::withBody([], [], [], (object) ['at' => $value]);
        $failure = new RecordedFailure();

        (new FormatRule($tree, Position::Member, $format, $checked))->validate('body.at', $value, $failure->callback());

        $recorded = array_map(static fn (ContractIssue $issue): array => [$issue->in, $issue->pointer, $issue->rule], $tree->issues());
        self::assertSame($failure->called, $recorded !== [], 'The rule fails the attribute exactly when it records an issue.');

        return $recorded;
    }
}
