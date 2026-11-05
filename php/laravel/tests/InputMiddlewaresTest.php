<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Events\Dispatcher;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Exceptions\Handler;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Golden\Tasks\Laravel\TasksContract;
use Seampact\Golden\Tasks\Laravel\TasksSeampactServiceProvider;
use Seampact\Hooks\RequestView;
use Seampact\Laravel\Runtime\Hooks;

/** Laravel's TrimStrings and ConvertEmptyStringsToNull, once the api's provider booted: they leave a contract route's input as sent. */
final class InputMiddlewaresTest extends TestCase
{
    protected function tearDown(): void
    {
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication(null);
    }

    public function testAContractRoutesInputIsNeitherTrimmedNorEmptiedToNull(): void
    {
        self::bootedProvider();
        $contractRequest = self::postWithBody('/v1/tasks');
        $contractRequest->attributes->set(BoundaryState::attributeName('tasks'), self::boundaryState());

        self::assertSame(['title' => ' padded ', 'note' => ''], self::inputAfterBothMiddlewares($contractRequest));
    }

    public function testAnotherRoutesInputIsStillTrimmedAndEmptiedToNull(): void
    {
        self::bootedProvider();

        self::assertSame(['title' => 'padded', 'note' => null], self::inputAfterBothMiddlewares(self::postWithBody('/other')));
    }

    private static function postWithBody(string $uri): Request
    {
        return Request::create($uri, 'POST', ['title' => ' padded ', 'note' => '']);
    }

    /** @return array<string, mixed> */
    private static function inputAfterBothMiddlewares(Request $request): array
    {
        $next = static fn (Request $passed): Request => $passed;

        (new ConvertEmptyStringsToNull())->handle($request, $next);
        (new TrimStrings())->handle($request, $next);

        return $request->request->all();
    }

    private static function boundaryState(): BoundaryState
    {
        return new BoundaryState(ApiContract::of(TasksContract::class), 'createTask', [], new RequestView('POST', '/v1/tasks', []), new Hooks(new Container()));
    }

    private static function bootedProvider(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository());
        $app->instance('files', new Filesystem());
        $app->instance('events', new Dispatcher($app));
        $app->instance('router', new Router(new Dispatcher($app), $app));
        $app->instance(ExceptionHandler::class, new Handler($app));
        $app->instance(\Illuminate\Contracts\Http\Kernel::class, new \stdClass());
        Facade::setFacadeApplication($app);

        $provider = new TasksSeampactServiceProvider($app);
        $provider->register();
        $provider->boot();
    }
}
