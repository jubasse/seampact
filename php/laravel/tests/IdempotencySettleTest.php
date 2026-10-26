<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Contracts\Http\Kernel as KernelContract;
use Illuminate\Events\Dispatcher;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Laravel\TasksBoundary;
use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\StoredResponse;

/** A key the request claimed is released when the request fails past the router, so a retry is not blocked. */
final class IdempotencySettleTest extends TestCase
{
    private const CLAIMED_KEY = 'claimed-key';

    public function testAKeyClaimedBeforeAThrowIsAbandoned(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['seampact' => []]));
        $kernel = new Kernel($app, new Router(new Dispatcher($app), $app));
        $kernel->prependMiddleware(TasksBoundary::class);
        $app->instance(KernelContract::class, $kernel);
        $store = new RecordingStore();
        $app->instance(IdempotencyStore::class, $store);
        $app->instance(LoggerInterface::class, new NullLogger());

        $request = Request::create('/v1/channels/10000000-0000-4000-8000-000000000001/tasks', 'POST');
        $reply = (new TasksBoundary($app))->handle($request, static function (Request $request): never {
            $state = BoundaryState::of($request, 'tasks') ?? throw new \LogicException('the boundary set no state');
            $state->idempotencyKey = self::CLAIMED_KEY;

            throw new \RuntimeException('the pipeline failed after the claim');
        });

        self::assertSame(500, $reply->getStatusCode());
        self::assertSame([self::CLAIMED_KEY], $store->abandoned);
    }
}

/** An idempotency store that records the keys it is told to abandon. */
final class RecordingStore implements IdempotencyStore
{
    /** @var list<string> */
    public array $abandoned = [];

    public function begin(IdempotencyClaim $claim): IdempotencyBegin
    {
        throw new \LogicException('not called by this test');
    }

    public function complete(string $key, StoredResponse $response): void
    {
        throw new \LogicException("the failed request completed '{$key}'");
    }

    public function abandon(string $key): void
    {
        $this->abandoned[] = $key;
    }
}
