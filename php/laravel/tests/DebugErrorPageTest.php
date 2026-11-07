<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Contracts\Http\Kernel as KernelContract;
use Illuminate\Events\Dispatcher;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Routing\Router;
use PHPUnit\Framework\TestCase;
use Psr\Log\AbstractLogger;
use Psr\Log\LoggerInterface;
use Seampact\Golden\TasksConsistent\Laravel\TasksBoundary;

/**
 * Under `app.debug` an exception no role maps on a contract route reaches Laravel's own handler and its error page,
 * and the boundary's log line names its message and `file:line`; outside debug the reply stays the api's 500.
 */
final class DebugErrorPageTest extends TestCase
{
    private const CONTRACT_PATH = '/v1/channels/10000000-0000-4000-8000-000000000001/tasks';
    private const FAILURE_MESSAGE = 'the handler failed on purpose';
    private const RENDERED_PAGE = "Laravel's error page";
    private const DEBUG = true;
    private const NO_DEBUG = false;

    public function testOutsideDebugAnUnmappedExceptionAnswersTheApisInternalError(): void
    {
        $logger = new LinesLogger();
        $reply = self::boundary(self::NO_DEBUG, $logger)->handle(self::request(), static fn (): Response => self::renderedPage());

        self::assertSame(500, $reply->getStatusCode());
        self::assertStringNotContainsString(self::RENDERED_PAGE, (string) $reply->getContent());
        self::assertStringContainsString('(' . \RuntimeException::class . ')', $logger->lines[0]);
        self::assertStringNotContainsString(self::FAILURE_MESSAGE, $logger->lines[0]);
    }

    public function testInDebugAnUnmappedExceptionKeepsLaravelsRenderedReplyAndLogsWhereItWasThrown(): void
    {
        $logger = new LinesLogger();
        $failure = new \RuntimeException(self::FAILURE_MESSAGE);
        $reply = self::boundary(self::DEBUG, $logger)->handle(self::request(), static fn (): Response => self::renderedPage($failure));

        self::assertSame(self::RENDERED_PAGE, $reply->getContent());
        self::assertStringContainsString(self::FAILURE_MESSAGE . ' at ' . $failure->getFile() . ':' . $failure->getLine(), $logger->lines[0]);
    }

    public function testOutsideDebugAThrownExceptionAnswersTheApisInternalError(): void
    {
        $reply = self::boundary(self::NO_DEBUG, new LinesLogger())->handle(self::request(), static fn (): never => throw new \RuntimeException(self::FAILURE_MESSAGE));

        self::assertSame(500, $reply->getStatusCode());
    }

    public function testInDebugAThrownExceptionIsRethrownToLaravelsHandler(): void
    {
        $failure = new \RuntimeException(self::FAILURE_MESSAGE);

        try {
            self::boundary(self::DEBUG, new LinesLogger())->handle(self::request(), static fn (): never => throw $failure);
            self::fail('the boundary answered instead of rethrowing');
        } catch (\RuntimeException $rethrown) {
            self::assertSame($failure, $rethrown);
        }
    }

    private static function boundary(bool $debug, LoggerInterface $logger): TasksBoundary
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['seampact' => [], 'app' => ['debug' => $debug]]));
        $kernel = new Kernel($app, new Router(new Dispatcher($app), $app));
        $kernel->prependMiddleware(TasksBoundary::class);
        $app->instance(KernelContract::class, $kernel);
        $app->instance(LoggerInterface::class, $logger);

        return new TasksBoundary($app);
    }

    private static function request(): Request
    {
        return Request::create(self::CONTRACT_PATH, 'GET');
    }

    // What Laravel's handler renders for an exception: a page carrying the exception it rendered.
    private static function renderedPage(?\Throwable $failure = null): Response
    {
        return (new Response(self::RENDERED_PAGE, 500))->withException($failure ?? new \RuntimeException(self::FAILURE_MESSAGE));
    }
}

/** A logger that keeps each line it is given. */
final class LinesLogger extends AbstractLogger
{
    /** @var list<string> */
    public array $lines = [];

    public function log($level, \Stringable|string $message, array $context = []): void
    {
        $this->lines[] = (string) $message;
    }
}
