<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\AccessSteps;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\IdempotencyStep;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\PrincipalMembers;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
use Seampact\Hooks\RequestView;

/** The boundary reads a principal through the members its identity declares, never through its PHP properties. */
final class PrincipalTest extends TestCase
{
    private const CLIENT_KEY = 'a-client-key';
    private const BUCKET = 'write';

    public function testTwoPrincipalsWithDifferentIdsHaveDifferentReplayPartitions(): void
    {
        self::assertNotSame(
            IdempotencyStep::partitionKey(self::stateOf(new UserPrincipal('alice')), self::CLIENT_KEY),
            IdempotencyStep::partitionKey(self::stateOf(new UserPrincipal('bob')), self::CLIENT_KEY),
        );
    }

    public function testAPrincipalWithOnlyPrivateStateReadsThroughItsAccessors(): void
    {
        self::assertNotSame(
            IdempotencyStep::partitionKey(self::stateOf(new PrivatePrincipal('alice')), self::CLIENT_KEY),
            IdempotencyStep::partitionKey(self::stateOf(new PrivatePrincipal('bob')), self::CLIENT_KEY),
        );
    }

    public function testABucketKeyedByAPrincipalMemberReadsItsValue(): void
    {
        $bucket = AccessSteps::throttleBucket(self::stateOf(new PrivatePrincipal('alice')), self::BUCKET);

        self::assertNotNull($bucket);
        self::assertSame(['alice'], $bucket->values);
    }

    public function testAPrincipalWithoutTheMembersInterfaceFailsLoud(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('does not implement ' . \Seampact\Golden\TasksConsistent\Laravel\UserPrincipalMembers::class);
        PrincipalMembers::read(ApiContract::of(TasksContract::class), 'user', new \stdClass());
    }

    private static function stateOf(object $principal): BoundaryState
    {
        $contract = ApiContract::of(TasksContract::class);
        $state = new BoundaryState($contract, 'createTask', [], new RequestView('POST', '/v1/tasks', []), new Hooks(new Container()));
        $state->principal = $principal;
        $state->principalMembers = PrincipalMembers::read($contract, 'user', $principal);

        return $state;
    }
}
