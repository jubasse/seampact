<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Auth\Access\Gate;
use Illuminate\Contracts\Auth\Access\Gate as GateContract;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\DecidedRight;
use Seampact\Hooks\Decision;
use Seampact\Laravel\Runtime\GateDecider;
use Seampact\Laravel\Runtime\Hooks;

/**
 * The opt-in Gate decider, tagged as an app tags it: the Gate's answer for the right decides, a denial answers the
 * right's first declared code, and the ability receives the principal, then the subject's loaded scope value, the other
 * scopes and the request.
 */
final class GateDeciderTest extends TestCase
{
    public function testAnAbilityTheGateAllowsAllowsTheRight(): void
    {
        $decision = DecidedRight::decide(self::hooks(static fn (): bool => true), DecidedRight::call(new \stdClass(), new \stdClass()));

        self::assertInstanceOf(Decision\Allowed::class, $decision);
    }

    public function testAnAbilityTheGateDeniesAnswersTheRightsFirstDeclaredCode(): void
    {
        $decision = DecidedRight::decide(self::hooks(static fn (): bool => false), DecidedRight::call(new \stdClass(), new \stdClass()));

        self::assertInstanceOf(Decision\Denied::class, $decision);
        self::assertSame(DecidedRight::FIRST_DENIAL_CODE, $decision->deny->code());
    }

    public function testTheAbilityReceivesThePrincipalTheSubjectsScopeValueTheOtherScopesAndTheRequest(): void
    {
        $received = [];
        $ability = static function (mixed ...$arguments) use (&$received): bool {
            $received = $arguments;

            return true;
        };
        $principal = new \stdClass();
        $project = new \stdClass();
        $call = DecidedRight::call($principal, $project);

        DecidedRight::decide(self::hooks($ability), $call);

        self::assertSame([$principal, $project, DecidedRight::WORKSPACE_ID, $call], $received);
    }

    private static function hooks(\Closure $ability): Hooks
    {
        $container = new Container();
        $gate = new Gate($container, static fn (): null => null);
        $gate->define(DecidedRight::RIGHT, $ability);
        $container->instance(GateContract::class, $gate);
        $container->tag([GateDecider::class], Hooks::decidersTag('tasks'));

        return new Hooks($container);
    }
}
