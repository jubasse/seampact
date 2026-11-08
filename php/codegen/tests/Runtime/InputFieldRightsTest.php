<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\Denial;
use Seampact\Codegen\Runtime\FieldRights;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\Decision;
use Seampact\Hooks\Purpose;
use Seampact\Hooks\RequirementRequest;
use Seampact\Hooks\RequestView;

/** Step 7 on the input: a restricted member sent without its right is refused naming its pointer, or stripped. */
final class InputFieldRightsTest extends TestCase
{
    public function testARestrictedMemberTheDeciderDeniesIsRefusedWithItsPointer(): void
    {
        $state = self::state((object) ['effort' => 5, 'title' => 't'], denied: ['/effort']);

        $refusal = self::refusal($state);

        self::assertSame('tasks.not_allowed', $refusal->contractCode);
        self::assertEquals((object) ['field' => '/effort'], $refusal->params);
    }

    public function testARestrictedMemberTheDeciderAllowsIsKept(): void
    {
        $state = self::state((object) ['effort' => 5, 'note' => 'n', 'a/b' => 1], denied: []);

        FieldRights::input($state);

        self::assertEquals((object) ['effort' => 5, 'note' => 'n', 'a/b' => 1], $state->body);
    }

    public function testAMemberUnderTheStripPolicyIsRemovedInsteadOfRefused(): void
    {
        $state = self::state((object) ['note' => 'n', 'title' => 't'], denied: ['/note']);

        FieldRights::input($state);

        self::assertEquals((object) ['title' => 't'], $state->body);
    }

    public function testAMemberNamedWithAnEscapedSlashIsFoundByItsRealName(): void
    {
        $state = self::state((object) ['a/b' => 1], denied: ['/a~1b']);

        self::assertEquals((object) ['field' => '/a~1b'], self::refusal($state)->params);
    }

    public function testAMemberThatWasNotSentAsksNoDecision(): void
    {
        $asked = [];
        $state = self::state((object) ['title' => 't'], denied: ['/effort'], asked: $asked);

        FieldRights::input($state);

        self::assertSame([], $asked);
    }

    public function testOnlyTheInputRightsAreAskedOfAnInputBody(): void
    {
        $asked = [];
        $state = self::state((object) ['secret' => 1, 'effort' => 1], denied: [], asked: $asked);

        FieldRights::input($state);

        self::assertSame(['/effort'], $asked);
    }

    public function testABodyThatIsNotAnObjectAsksNoDecision(): void
    {
        $asked = [];
        $state = self::state([['effort' => 1]], denied: ['/effort'], asked: $asked);

        FieldRights::input($state);

        self::assertSame([], $asked);
    }

    public function testADeciderThatThrowsRefusesTheRequestInsteadOfKeepingTheMember(): void
    {
        $state = self::state((object) ['effort' => 1], denied: [], decide: static fn () => throw new \RuntimeException('policy down'));

        $this->expectException(\RuntimeException::class);
        FieldRights::input($state);
    }

    private static function refusal(BoundaryState $state): ContractRefusal
    {
        try {
            FieldRights::input($state);
        } catch (ContractRefusal $refusal) {
            return $refusal;
        }

        self::fail('The restricted member was let through.');
    }

    /**
     * @param list<string> $denied the pointers the decider denies
     * @param list<string> $asked filled with the pointers the decider is asked about
     */
    private static function state(mixed $body, array $denied, array &$asked = [], ?\Closure $decide = null): BoundaryState
    {
        $decide ??= static function (RequirementRequest $request) use ($denied, &$asked): Decision {
            $purpose = $request->purpose();
            self::assertInstanceOf(Purpose\Field::class, $purpose);
            $asked[] = $purpose->pointer;

            return in_array($purpose->pointer, $denied, true) ? new Decision\Denied(new Denial('tasks.not_allowed')) : new Decision\Allowed();
        };
        $hooks = new ScriptedHooks(static fn (): never => throw new \LogicException('n/a'), static fn (): never => throw new \LogicException('n/a'), $decide);
        $state = new BoundaryState(ApiContract::of(InputFieldRightsContract::class), 'updateTask', [], new RequestView('PATCH', '/v1/tasks/1', []), $hooks);
        $state->body = $body;

        return $state;
    }
}
