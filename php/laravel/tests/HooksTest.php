<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\UnexpectedFailure;
use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\StoredResponse;
use Seampact\Laravel\Runtime\Hooks;

final class HooksTest extends TestCase
{
    public function testNoListenerBindingIsNoListener(): void
    {
        self::assertNull((new Hooks(new Container()))->unexpectedErrorListener(ApiContract::of(TasksListenerContract::class)));
    }

    public function testAListenerBoundToTheWrongTypeIsRefusedByName(): void
    {
        $container = new Container();
        $container->bind(TasksUnexpectedErrorListener::class, static fn (): \stdClass => new \stdClass());

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('the container binds ' . TasksUnexpectedErrorListener::class . ' to stdClass');
        (new Hooks($container))->unexpectedErrorListener(ApiContract::of(TasksListenerContract::class));
    }

    public function testTwoApisEachReachTheListenerBoundToTheirOwnInterface(): void
    {
        $tasksListener = new class () implements TasksUnexpectedErrorListener {
            public function onUnexpectedError(UnexpectedFailure $failure): void
            {
            }
        };
        $serviceListener = new class () implements ServiceUnexpectedErrorListener {
            public function onUnexpectedError(UnexpectedFailure $failure): void
            {
            }
        };
        $container = new Container();
        $container->instance(TasksUnexpectedErrorListener::class, $tasksListener);
        $container->instance(ServiceUnexpectedErrorListener::class, $serviceListener);
        $hooks = new Hooks($container);

        self::assertSame($tasksListener, $hooks->unexpectedErrorListener(ApiContract::of(TasksListenerContract::class)));
        self::assertSame($serviceListener, $hooks->unexpectedErrorListener(ApiContract::of(ServiceListenerContract::class)));
    }

    public function testTwoApisEachReachTheIdempotencyStoreBoundUnderTheirOwnKey(): void
    {
        $tasksStore = self::unusedStore();
        $serviceStore = self::unusedStore();
        $container = new Container();
        $container->instance(Hooks::idempotencyStoreKey('tasks'), $tasksStore);
        $container->instance(Hooks::idempotencyStoreKey('service'), $serviceStore);
        $hooks = new Hooks($container);

        self::assertSame($tasksStore, $hooks->idempotencyStore(ApiContract::of(TasksListenerContract::class)));
        self::assertSame($serviceStore, $hooks->idempotencyStore(ApiContract::of(ServiceListenerContract::class)));
    }

    public function testADenialAsNotFoundIsAnAccessDenialHidingTheRecord(): void
    {
        $hooks = new Hooks(new Container());
        $hidden = (new AuthorizationException())->asNotFound();

        self::assertTrue($hooks->isAccessDenial($hidden));
        self::assertTrue($hooks->isNotFoundDenial($hidden));
        self::assertFalse($hooks->isNotFoundDenial(new AuthorizationException()));
        self::assertFalse($hooks->isNotFoundDenial((new AuthorizationException())->withStatus(403)));
    }

    private static function unusedStore(): IdempotencyStore
    {
        return new class () implements IdempotencyStore {
            public function begin(IdempotencyClaim $claim): IdempotencyBegin
            {
                throw new \LogicException('not called by this test');
            }

            public function complete(string $key, StoredResponse $response): void
            {
                throw new \LogicException('not called by this test');
            }

            public function abandon(string $key): void
            {
                throw new \LogicException('not called by this test');
            }
        };
    }
}
