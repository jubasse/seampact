<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\AbstractLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractBypassedException;
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
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Validator\Validation;

/**
 * Under `kernel.debug` an exception no role maps on a contract route reaches Symfony's error page, and the boundary's
 * log line names its message and `file:line`; outside debug the reply stays the api's 500.
 */
final class DebugErrorPageTest extends TestCase
{
    private const FAILURE_MESSAGE = 'the handler failed on purpose';
    private const ERROR_PAGE = "Symfony's error page";
    private const DEBUG = true;
    private const NO_DEBUG = false;

    public function testOutsideDebugAnUnmappedExceptionAnswersTheApisInternalError(): void
    {
        $logger = new DebugLinesLogger();
        $reply = $this->served(self::NO_DEBUG, $logger, new \RuntimeException(self::FAILURE_MESSAGE));

        self::assertSame(500, $reply->getStatusCode());
        self::assertNotSame(self::ERROR_PAGE, $reply->getContent());
        self::assertStringContainsString('(' . \RuntimeException::class . ')', $logger->lines[0]);
        self::assertStringNotContainsString(self::FAILURE_MESSAGE, $logger->lines[0]);
    }

    public function testInDebugAnUnmappedExceptionKeepsSymfonysErrorPageAndLogsWhereItWasThrown(): void
    {
        $logger = new DebugLinesLogger();
        $failure = new \RuntimeException(self::FAILURE_MESSAGE);
        $reply = $this->served(self::DEBUG, $logger, $failure);

        self::assertSame(self::ERROR_PAGE, $reply->getContent());
        self::assertCount(1, $logger->lines);
        self::assertStringContainsString(self::FAILURE_MESSAGE . ' at ' . $failure->getFile() . ':' . $failure->getLine(), $logger->lines[0]);
    }

    public function testInDebugABypassedBoundaryKeepsSymfonysErrorPage(): void
    {
        $reply = $this->served(self::DEBUG, new DebugLinesLogger(), new ContractBypassedException(self::FAILURE_MESSAGE));

        self::assertSame(self::ERROR_PAGE, $reply->getContent());
    }

    // The boundary's listeners in the kernel's order, with Symfony's `ErrorListener` writing its page when none answered.
    private function served(bool $debug, DebugLinesLogger $logger, \Throwable $failure): Response
    {
        $hooks = new Hooks(new ServiceLocator([]), [], [], null, $logger, null, $debug);
        $boundary = new TasksBoundary($hooks, new TasksSettings(null, null, [], 'https://api.example.com'), Validation::createValidator());
        $contract = ApiContract::of(TasksContract::class);

        $request = Request::create('/v1/tasks', 'POST');
        $state = new BoundaryState($contract, $contract->operationIds()[0], [], RawTarget::view($request), $hooks);
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        $kernel = $this->createStub(HttpKernelInterface::class);
        $exceptionEvent = new ExceptionEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $failure);
        $boundary->onFirstException($exceptionEvent);
        $boundary->onException($exceptionEvent);
        $boundary->onUnmappedException($exceptionEvent);
        $written = $exceptionEvent->getResponse() ?? new Response(self::ERROR_PAGE, 500, ['Content-Type' => 'text/html']);

        $responseEvent = new ResponseEvent($kernel, $request, HttpKernelInterface::MAIN_REQUEST, $written);
        $boundary->onResponse($responseEvent);

        return $responseEvent->getResponse();
    }
}

/** A logger that keeps each line it is given. */
final class DebugLinesLogger extends AbstractLogger
{
    /** @var list<string> */
    public array $lines = [];

    public function log($level, \Stringable|string $message, array $context = []): void
    {
        $this->lines[] = (string) $message;
    }
}
