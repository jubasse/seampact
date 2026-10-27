<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Kernel as HttpKernel;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Laravel\Runtime\AccessMiddleware;
use Seampact\Laravel\Runtime\BootCheck;
use Seampact\Laravel\Runtime\BootCheckFailedException;
use Seampact\Laravel\Runtime\BoundaryMiddleware;

/** The boot check's rule on the app's exception handler, which must take the api's `renderable` callbacks. */
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
}
