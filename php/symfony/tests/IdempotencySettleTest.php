<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\RawTarget;
use Seampact\Golden\TasksConsistent\Symfony\TasksBoundary;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksSettings;
use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\StoredResponse;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Validator\Validation;

/** A key the request claimed is released when the boundary answers the api's 500, so a retry is not blocked. */
final class IdempotencySettleTest extends TestCase
{
    private const CLAIMED_KEY = 'claimed-key';

    public function testAKeyClaimedBeforeAnUnmappedExceptionIsAbandoned(): void
    {
        $store = new RecordingStore();
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger(), $store);
        $boundary = new TasksBoundary($hooks, new TasksSettings(null, null, [], 'https://api.example.com'), Validation::createValidator());
        $contract = ApiContract::of(TasksContract::class);
        $operationId = $contract->operationIds()[0];

        $request = Request::create('/v1/tasks', 'POST');
        $state = new BoundaryState($contract, $operationId, [], RawTarget::view($request), $hooks);
        $state->idempotencyKey = self::CLAIMED_KEY;
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        $kernel = $this->createStub(HttpKernelInterface::class);
        $failure = new \RuntimeException('the handler failed after the claim');
        $exceptionEvent = new ExceptionEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $failure);
        $boundary->onFirstException($exceptionEvent);
        $boundary->onException($exceptionEvent);
        $boundary->onUnmappedException($exceptionEvent);
        $reply = $exceptionEvent->getResponse();
        self::assertNotNull($reply);

        $boundary->onResponse(new ResponseEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $reply));

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
