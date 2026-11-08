<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\InputRuleCheck;
use Seampact\Codegen\Runtime\InputRuleSet;
use Seampact\Codegen\Runtime\InputRulesLookup;

/** The boot check lists every input rule problem with the operation and the fix, and accepts rules that fit. */
final class InputRuleCheckTest extends TestCase
{
    private const FIX = 'tag it';

    public function testRulesThatFitTheContractAreNoProblem(): void
    {
        self::assertSame([], self::problems(self::set('scheduleTask', 'body'), self::set('scheduleTask', 'headers'), self::set('getTask', 'path')));
    }

    public function testNoRulesAreNoProblem(): void
    {
        self::assertSame([], self::problems());
    }

    public function testAnUnknownOperationIsNamedWithItsFix(): void
    {
        $problems = self::problems(self::set('scheduleTsk', 'body'));

        self::assertCount(1, $problems);
        self::assertStringContainsString("input rules for operation 'scheduleTsk', which api 'tasks' lacks or whose entry's `operations` filter drops", $problems[0]);
    }

    public function testAPartWithoutInputListsThePartsThatHaveInput(): void
    {
        $problems = self::problems(self::set('getTask', 'body'), self::set('getTask', 'query'));

        self::assertStringContainsString("the part 'body' of operation 'getTask', which has no body", $problems[0]);
        self::assertStringContainsString("the part 'query' of operation 'getTask', which has no input there: name a part with input (path)", $problems[1]);
    }

    public function testTwoRuleSetsForOnePartAreRefused(): void
    {
        $problems = self::problems(self::set('scheduleTask', 'body'), self::set('scheduleTask', 'body'));

        self::assertCount(1, $problems);
        self::assertStringContainsString("two input rule sets claim the part 'body' of operation 'scheduleTask'", $problems[0]);
    }

    public function testARelayOperationTakesNoRulesAndNamesItsPublicOperation(): void
    {
        $problems = self::problems(self::set('relayedTask', 'body'));

        self::assertStringContainsString("operation 'relayedTask', which relays 'scheduleTask' of api 'upstream'", $problems[0]);
    }

    public function testABodyThatIsNeitherAnObjectNorAListIsRefused(): void
    {
        self::assertStringContainsString('neither an object nor a list', self::problems(self::set('uploadTask', 'body'))[0]);
    }

    public function testAServiceThatIsNoRuleSetIsRefused(): void
    {
        $problems = self::problems(new \stdClass());

        self::assertStringContainsString('the input rules service stdClass does not implement ' . InputRuleSet::class, $problems[0]);
    }

    /** @return list<string> */
    private static function problems(object ...$registered): array
    {
        $lookup = new class (array_values($registered)) implements InputRulesLookup {
            /** @param list<object> $registered */
            public function __construct(private readonly array $registered)
            {
            }

            public function inputRules(ApiContract $contract): iterable
            {
                return $this->registered;
            }
        };

        return InputRuleCheck::problems($lookup, ApiContract::of(InputRulesContract::class), InputRuleSet::class, self::FIX);
    }

    private static function set(string $operationId, string $part): InputRuleSet
    {
        return new class ($operationId, $part) implements InputRuleSet {
            public function __construct(private readonly string $operationId, private readonly string $part)
            {
            }

            public function operationId(): string
            {
                return $this->operationId;
            }

            public function part(): string
            {
                return $this->part;
            }
        };
    }
}
