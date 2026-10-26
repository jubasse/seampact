<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Symfony\Runtime\Checks;
use Seampact\Symfony\Runtime\Format;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\Issue;
use Seampact\Symfony\Runtime\JsonType;
use Seampact\Symfony\Runtime\KeyPolicy;
use Seampact\Symfony\Runtime\Member;
use Seampact\Symfony\Runtime\Nullability;
use Seampact\Symfony\Runtime\PatternScope;
use Seampact\Symfony\Runtime\Presence;
use Seampact\Symfony\Runtime\Rule;
use Seampact\Symfony\Tests\Support\ShapeConstraint;
use Symfony\Component\Validator\Constraints\Length;
use Symfony\Component\Validator\Constraints\Regex;
use Symfony\Component\Validator\Constraints\Uuid;
use Symfony\Component\Validator\Validation;

/** The generated input constraint run in Symfony's Validator on bodies decoded as the boundary decodes them. */
final class InputConstraintTest extends TestCase
{
    public function testAnExplicitNullPassesOnlyANullableMemberAndAnAbsentKeyOnlyAnOptionalOne(): void
    {
        $body = self::object([
            'note' => new Member(JsonType::String, nullability: Nullability::Nullable),
            'title' => new Member(JsonType::String),
            'due' => new Member(JsonType::String, presence: Presence::Optional),
        ]);

        self::assertSame([], self::issues($body, '{"note":null,"title":"x"}'));
        self::assertSame(['/body/title type'], self::issues($body, '{"note":null,"title":null}'));
        self::assertSame(['/body/note required'], self::issues($body, '{"title":"x"}'));
    }

    public function testAnIntegerTakesAWholeNumberInTheSafeRangeAndRefusesALargerOneAsItsBound(): void
    {
        $body = self::object(['count' => new Member(JsonType::Integer, presence: Presence::Optional)]);

        self::assertSame([], self::issues($body, '{"count":1.0}'));
        self::assertSame([], self::issues($body, '{"count":9007199254740991}'));
        self::assertSame(['/body/count maximum'], self::issues($body, '{"count":9007199254740992}'));
        self::assertSame(['/body/count minimum'], self::issues($body, '{"count":-9007199254740993}'));
        self::assertSame(['/body/count type'], self::issues($body, '{"count":1.5}'));
        self::assertSame(['/body/count type'], self::issues($body, '{"count":"1"}'));
        self::assertSame(['/body/count maximum'], self::issues($body, '{"count":9007199254740994.0}'));
        self::assertSame(['/body/count maximum'], self::issues($body, '{"count":9223372036854775808}'));
        self::assertSame(['/body/count minimum'], self::issues($body, '{"count":-9223372036854775809}'));
    }

    public function testABigJsonNumberIsANumberNeverAString(): void
    {
        $body = self::object([
            'id' => new Member(JsonType::String, presence: Presence::Optional),
            'amount' => new Member(JsonType::Number, presence: Presence::Optional),
        ]);

        self::assertSame(['/body/id type'], self::issues($body, '{"id":123456789012345678901234}'));
        self::assertSame([], self::issues($body, '{"id":"123456789012345678901234","amount":123456789012345678901234}'));
    }

    public function testAnUnknownKeyIsAnIssueAtItsOwnPointerUnlessTheObjectKeepsIt(): void
    {
        $members = ['a' => new Member(JsonType::Integer)];

        self::assertSame(['/body/x~1y unknownKeys'], self::issues(self::object($members), '{"a":1,"x/y":2}'));
        self::assertSame([], self::issues(new Member(JsonType::Object, properties: $members, unknownKeys: KeyPolicy::Keep), '{"a":1,"x":2}'));
        self::assertSame(['/body type'], self::issues(self::object($members), '[]'));
    }

    public function testAnUnknownQueryParameterIsRefusedOnlyUnderTheRefusingPolicy(): void
    {
        $query = ['limit' => new Member(JsonType::String, presence: Presence::Optional)];
        $input = (object) ['path' => new \stdClass(), 'query' => (object) ['other' => 'x'], 'header' => new \stdClass()];

        self::assertSame(['/query/other unknownKeys'], self::validated(new InputShape(query: $query, unknownQuery: KeyPolicy::Refuse), $input));
        self::assertSame([], self::validated(new InputShape(query: $query), $input));
    }

    public function testAnEmptyStringNeverPassesAPatternOrAFormatUnderNativeRules(): void
    {
        $body = self::object([
            'code' => new Member(JsonType::String, presence: Presence::Optional, checks: new Checks(pattern: '/^[a-z]+$/u', patternScope: PatternScope::EmptyStringOnly), native: [new Regex('/^[a-z]+$/u', payload: Rule::payload(Rule::PATTERN))]),
            'id' => new Member(JsonType::String, presence: Presence::Optional, checks: new Checks(format: Format::Uuid, formatScope: PatternScope::EmptyStringOnly), native: [new Uuid(payload: Rule::payload(Rule::FORMAT))]),
            'name' => new Member(JsonType::String, presence: Presence::Optional, native: [new Length(min: 1, payload: Rule::payload(Rule::MIN_LENGTH))]),
        ]);

        self::assertSame(['/body/code pattern', '/body/id format', '/body/name minLength'], self::issues($body, '{"code":"","id":"","name":""}'));
        self::assertSame(['/body/code pattern', '/body/id format'], self::issues($body, '{"code":"A","id":"nope","name":"x"}'));
        self::assertSame([], self::issues($body, '{"code":"ab","id":"6f1c2b9e-0a43-4c8e-9a51-1f2d3c4b5a69","name":"x"}'));
    }

    public function testABlankStringNeverPassesAUuidUnderNativeRules(): void
    {
        $body = self::object([
            'id' => new Member(JsonType::String, checks: new Checks(format: Format::Uuid, formatScope: PatternScope::EmptyStringOnly), native: [new Uuid(payload: Rule::payload(Rule::FORMAT))]),
        ]);

        self::assertSame(['/body/id format'], self::issues($body, '{"id":"   "}'));
        self::assertSame(['/body/id format'], self::issues($body, '{"id":""}'));
    }

    public function testANativeConstraintBrokenTwiceReportsItsRuleOnce(): void
    {
        $body = self::object(['id' => new Member(JsonType::String, native: [new Uuid(payload: Rule::payload(Rule::FORMAT))])]);

        self::assertSame(['/body/id format'], self::issues($body, '{"id":"00000000-0000-0000-0000-000000000000"}'));
    }

    public function testANonFiniteNumberIsATypeIssue(): void
    {
        $body = self::object([
            'amount' => new Member(JsonType::Number, presence: Presence::Optional),
            'count' => new Member(JsonType::Integer, presence: Presence::Optional),
        ]);

        self::assertSame(['/body/amount type', '/body/count type'], self::issues($body, '{"amount":1e400,"count":-1e400}'));
    }

    public function testAnIntegerStepIsExactOnAWholeFloat(): void
    {
        $body = self::object(['count' => new Member(JsonType::Integer, checks: new Checks(multipleOf: 7))]);

        self::assertSame(['/body/count multipleOf'], self::issues($body, '{"count":9007199254740990.0}'));
        self::assertSame([], self::issues($body, '{"count":9007199254740988.0}'));
        self::assertSame(['/body/count multipleOf'], self::issues($body, '{"count":15}'));
        self::assertSame([], self::issues($body, '{"count":14}'));
    }

    public function testConsistentRulesCountCodePointsAndSearchTheEmptyStringToo(): void
    {
        $body = self::object([
            'tag' => new Member(JsonType::String, presence: Presence::Optional, checks: new Checks(minLength: 1, maxLength: 2, pattern: '/^\p{L}+$/uD')),
            'ids' => new Member(JsonType::List, presence: Presence::Optional, checks: new Checks(maxItems: 1), items: new Member(JsonType::String, checks: new Checks(format: Format::Uuid))),
        ]);

        self::assertSame([], self::issues($body, '{"tag":"éà"}'));
        self::assertSame(['/body/tag minLength', '/body/tag pattern'], self::issues($body, '{"tag":""}'));
        self::assertSame(['/body/ids maxItems', '/body/ids/1 format'], self::issues($body, '{"ids":["6f1c2b9e-0a43-4c8e-9a51-1f2d3c4b5a69","x"]}'));
    }

    public function testATypeIssueIsTheMembersOnlyIssue(): void
    {
        $body = self::object(['tag' => new Member(JsonType::String, checks: new Checks(minLength: 3), native: [new Length(max: 1, payload: Rule::payload(Rule::MAX_LENGTH))])]);

        self::assertSame(['/body/tag type'], self::issues($body, '{"tag":12}'));
    }

    /** @param array<string, Member> $members */
    private static function object(array $members): Member
    {
        return new Member(JsonType::Object, properties: $members);
    }

    /** @return list<string> each issue as "<pointer> <rule>" */
    private static function issues(Member $body, string $json): array
    {
        $input = (object) ['path' => new \stdClass(), 'query' => new \stdClass(), 'header' => new \stdClass(), 'body' => json_decode($json, false, 512, JSON_THROW_ON_ERROR)];

        return self::validated(new InputShape(body: $body), $input);
    }

    /** @return list<string> */
    private static function validated(InputShape $shape, \stdClass $input): array
    {
        ShapeConstraint::$shape = $shape;
        $violations = Validation::createValidator()->validate($input, new ShapeConstraint());

        $issues = [];
        foreach ($violations as $violation) {
            $issues[] = $violation->getPropertyPath() . ' ' . Issue::ruleOf($violation);
        }

        return $issues;
    }
}
