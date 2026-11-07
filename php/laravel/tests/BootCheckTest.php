<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Kernel as HttpKernel;
use Illuminate\Routing\Router;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Laravel\Runtime\AccessMiddleware;
use Seampact\Laravel\Runtime\BootCheck;
use Seampact\Laravel\Runtime\BootCheckFailedException;
use Seampact\Laravel\Runtime\BoundaryMiddleware;

/**
 * The boot check's rules on the app's exception handler, which must take the api's `renderable` callbacks, and on the
 * framework routes the entry's `frameworkRoutes` allow-lists.
 */
final class BootCheckTest extends TestCase
{
    private const SWITCHES = [BootCheck::HOOKS => false, BootCheck::HANDLERS => false, BootCheck::FRAMEWORK_ROUTES => false];

    public function testAHandlerWithoutRenderableIsNamedWithTheFix(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository([]));
        $app->singleton(Kernel::class, HttpKernel::class);
        $app->instance(ExceptionHandler::class, self::createStub(ExceptionHandler::class));

        $this->expectException(BootCheckFailedException::class);
        $this->expectExceptionMessageMatches("/has no 'renderable' method, so an AuthenticationException on a contract route cannot answer the api's 401: extend Illuminate\\\\Foundation\\\\Exceptions\\\\Handler/");

        BootCheck::run($app, ApiContract::of(TasksContract::class), BoundaryMiddleware::class, AccessMiddleware::class, self::SWITCHES);
    }

    public function testARelativeApiRefusesAPublicOriginThatIsSet(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['seampact' => ['tasks' => ['public_origin' => 'https://api.example.com']]]));
        $app->singleton(Kernel::class, HttpKernel::class);
        $app->instance(ExceptionHandler::class, self::createStub(ExceptionHandler::class));

        $this->expectException(BootCheckFailedException::class);
        $this->expectExceptionMessageMatches("/the api writes relative URLs \\('api.wire.urls: relative'\\) and 'seampact.tasks.public_origin' is set/");

        BootCheck::run($app, ApiContract::of(TasksContract::class), BoundaryMiddleware::class, AccessMiddleware::class, self::SWITCHES);
    }

    public function testACatchAllRouteIsAllowListedByTwoStarsOnlyNeverByOneStar(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository([]));
        $app->singleton(Kernel::class, HttpKernel::class);
        $app->instance(ExceptionHandler::class, self::createStub(ExceptionHandler::class));
        $router = $app->make(Router::class);
        $router->get('/v1/files/{path}', static fn (): string => '')->where('path', '.*');
        $router->get('/v1/docs/{path}', static fn (): string => '')->where('path', '.*');

        $problems = '';
        try {
            BootCheck::run($app, ApiContract::of(CatchAllAllowListContract::class), BoundaryMiddleware::class, AccessMiddleware::class, [...self::SWITCHES, BootCheck::FRAMEWORK_ROUTES => true]);
        } catch (BootCheckFailedException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString('the framework route GET|HEAD /v1/files/{path} is outside the contract', $problems);
        self::assertStringNotContainsString('/v1/docs/{path}', $problems);
    }

    public function testARouteWithAnOptionalParameterIsAllowListedOnlyWhenThePathWithoutItIsListedToo(): void
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository([]));
        $app->singleton(Kernel::class, HttpKernel::class);
        $app->instance(ExceptionHandler::class, self::createStub(ExceptionHandler::class));
        $router = $app->make(Router::class);
        $router->get('/v1/files/{name?}', static fn (): string => '');
        $router->get('/v1/files/{id}', static fn (): string => '');
        $router->get('/v1/docs/{name?}', static fn (): string => '');

        $problems = '';
        try {
            BootCheck::run($app, ApiContract::of(CatchAllAllowListContract::class), BoundaryMiddleware::class, AccessMiddleware::class, [...self::SWITCHES, BootCheck::FRAMEWORK_ROUTES => true]);
        } catch (BootCheckFailedException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString('the framework route GET|HEAD /v1/files/{name?} is outside the contract', $problems);
        self::assertStringContainsString('and one with an optional parameter only by entries that also take its path without it', $problems);
        self::assertStringNotContainsString('/v1/files/{id}', $problems, 'a required parameter stays one segment');
        self::assertStringNotContainsString('/v1/docs/{name?}', $problems);
    }
}
