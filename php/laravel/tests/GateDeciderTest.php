<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Auth\Access\Gate;
use Illuminate\Contracts\Auth\Access\Gate as GateContract;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\DecidedRight;
use Seampact\Hooks\Decision;
use Seampact\Hooks\ResolvedScope;
use Seampact\Laravel\Runtime\GateDecider;
use Seampact\Laravel\Runtime\Hooks;

/**
 * The opt-in Gate decider, tagged as an app tags it: the Gate's answer for the right decides, a denial answers the
 * right's first declared code, and the ability receives the principal, then the subject's loaded scope value, the other
 * scopes (their value, else the scope itself) and the request. A client-sent id never picks the Policy.
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

        self::assertSame([$principal, $project, $call->scopes()[0], $call], $received);
        self::assertInstanceOf(ResolvedScope::class, $received[2]);
    }

    public function testAnUndefinedAbilityIsDenied(): void
    {
        $decision = DecidedRight::decide(self::hooksOf(new Gate(new Container(), static fn (): null => null)), DecidedRight::call(new \stdClass(), new \stdClass()));

        self::assertInstanceOf(Decision\Denied::class, $decision);
    }

    public function testAnUnloadedSubjectWhoseIdNamesAPolicyClassDoesNotPickThatPolicy(): void
    {
        $container = new Container();
        $gate = new Gate($container, static fn (): null => null);
        $gate->define(DecidedRight::RIGHT, static fn (): bool => false);
        $gate->policy(\stdClass::class, EveryAbilityPolicy::class);

        $decision = DecidedRight::decide(self::hooksOf($gate), DecidedRight::callOnUnloadedProject(new \stdClass(), \stdClass::class));

        self::assertInstanceOf(Decision\Denied::class, $decision);
    }

    public function testAnUnloadedSubjectReachesTheAbilityAsItsReference(): void
    {
        $received = [];
        $ability = static function (mixed ...$arguments) use (&$received): bool {
            $received = $arguments;

            return true;
        };
        $call = DecidedRight::callOnUnloadedProject(new \stdClass(), DecidedRight::PROJECT_ID);

        DecidedRight::decide(self::hooks($ability), $call);

        self::assertSame($call->subject(), $received[1]);
    }

    private static function hooks(\Closure $ability): Hooks
    {
        $gate = new Gate(new Container(), static fn (): null => null);
        $gate->define(DecidedRight::RIGHT, $ability);

        return self::hooksOf($gate);
    }

    private static function hooksOf(Gate $gate): Hooks
    {
        $container = new Container();
        $container->instance(GateContract::class, $gate);
        $container->tag([GateDecider::class], Hooks::decidersTag('tasks'));

        return new Hooks($container);
    }
}
