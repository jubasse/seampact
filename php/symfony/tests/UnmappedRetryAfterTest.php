<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\RawTarget;
use Seampact\Golden\TasksConsistent\Symfony\TasksBoundary;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksSettings;
use Seampact\Symfony\Runtime\Hooks;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Validator\Validation;

/** The api's 500 for a native refusal no declared code answers carries no `Retry-After`, as on Laravel and Node. */
final class UnmappedRetryAfterTest extends TestCase
{
    private const TEAPOT_STATUS = 418;

    public function testTheInternalErrorOfAnUnansweredRefusalDropsTheExceptionsRetryAfter(): void
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger());
        $boundary = new TasksBoundary($hooks, new TasksSettings(null, null, [], 'https://api.example.com'), Validation::createValidator());
        $contract = ApiContract::of(TasksContract::class);

        $request = Request::create('/v1/tasks', 'POST');
        $state = new BoundaryState($contract, $contract->operationIds()[0], [], RawTarget::view($request), $hooks);
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        $kernel = $this->createStub(HttpKernelInterface::class);
        $refusal = new class (self::TEAPOT_STATUS) extends HttpException {
            public function getRetryAfter(): \DateTimeImmutable
            {
                return new \DateTimeImmutable('+30 seconds');
            }
        };
        $exceptionEvent = new ExceptionEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $refusal);
        $boundary->onFirstException($exceptionEvent);
        $boundary->onException($exceptionEvent);
        $boundary->onUnmappedException($exceptionEvent);
        $written = $exceptionEvent->getResponse() ?? new Response('', self::TEAPOT_STATUS);

        $responseEvent = new ResponseEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $written);
        $boundary->onResponse($responseEvent);
        $reply = $responseEvent->getResponse();

        self::assertSame(500, $reply->getStatusCode());
        self::assertFalse($reply->headers->has('Retry-After'));
    }
}
