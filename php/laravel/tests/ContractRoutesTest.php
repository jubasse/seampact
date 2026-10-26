<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Events\Dispatcher;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Routing\Router;
use Illuminate\Routing\UrlGenerator;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Laravel\TasksRoutes;

/** The registered contract routes: placeholders named after the input properties, and CSRF only where a cookie credential is read. */
final class ContractRoutesTest extends TestCase
{
    protected function tearDown(): void
    {
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication(null);
    }

    public function testPlaceholdersAreNamedAfterTheInputPropertiesSoRouteBuildsTheUrl(): void
    {
        $router = self::registeredRouter();
        $getTask = self::route($router, 'seampact.tasks.getTask');
        $urls = new UrlGenerator($router->getRoutes(), Request::create('http://localhost'));

        self::assertSame(['channelId', 'taskId'], $getTask->parameterNames());
        self::assertSame('/v1/channels/c1/tasks/t1', $urls->route('seampact.tasks.getTask', ['channelId' => 'c1', 'taskId' => 't1'], false));
    }

    public function testCsrfIsLeftOffEveryOperationThatReadsNoCookieCredential(): void
    {
        $router = self::registeredRouter();

        self::assertContains(PreventRequestForgery::class, self::route($router, 'seampact.tasks.health')->excludedMiddleware());
        self::assertContains(PreventRequestForgery::class, self::route($router, 'seampact.tasks.payments')->excludedMiddleware());
        self::assertNotContains(PreventRequestForgery::class, self::route($router, 'seampact.tasks.createTask')->excludedMiddleware());
    }

    private static function route(Router $router, string $name): Route
    {
        return $router->getRoutes()->getByName($name) ?? self::fail("No route named '{$name}' was registered.");
    }

    private static function registeredRouter(): Router
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['seampact' => ['tasks' => TasksRoutes::DEFAULTS]]));
        $router = new Router(new Dispatcher($app), $app);
        $app->instance('router', $router);
        Facade::setFacadeApplication($app);

        TasksRoutes::register();
        $router->getRoutes()->refreshNameLookups();

        return $router;
    }
}
