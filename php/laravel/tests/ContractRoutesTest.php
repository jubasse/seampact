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
use Seampact\Golden\TasksConsistent\Laravel\TasksRouteNames;
use Seampact\Golden\TasksConsistent\Laravel\TasksRoutes;
use Seampact\Golden\TasksConsistent\Laravel\TasksUrls;

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

    public function testEachRouteNameConstantNamesOneRegisteredRoute(): void
    {
        $registered = array_values(array_filter(array_map(static fn (Route $route): ?string => $route->getName(), self::registeredRouter()->getRoutes()->getRoutes())));
        $constants = array_values((new \ReflectionClass(TasksRouteNames::class))->getConstants());
        sort($registered);
        sort($constants);

        self::assertSame($registered, $constants);
    }

    public function testTheUrlBuilderGivesThePathTheRouterBuilds(): void
    {
        $urls = new UrlGenerator(self::registeredRouter()->getRoutes(), Request::create('http://localhost'));

        self::assertSame($urls->route(TasksRouteNames::GET_TASK, ['channelId' => 'c1', 'taskId' => 't1'], false), TasksUrls::getTask('c1', 't1'));
        self::assertSame('/v1/channels/a%2Fb/tasks/%20%3F%23', TasksUrls::getTask('a/b', ' ?#'));
    }

    public function testAnAppsGlobalPatternNeverNarrowsAContractPlaceholder(): void
    {
        $router = self::registeredRouter(['channelId' => '[0-9]+']);

        $matched = $router->getRoutes()->match(Request::create('http://localhost/v1/channels/c1/tasks/t1'));

        self::assertSame('seampact.tasks.getTask', $matched->getName());
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

    /** @param array<string, string> $appPatterns the app's global `Route::pattern` constraints */
    private static function registeredRouter(array $appPatterns = []): Router
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository(['seampact' => ['tasks' => TasksRoutes::DEFAULTS]]));
        $router = new Router(new Dispatcher($app), $app);
        $app->instance('router', $router);
        Facade::setFacadeApplication($app);
        $router->patterns($appPatterns);

        TasksRoutes::register();
        $router->getRoutes()->refreshNameLookups();

        return $router;
    }
}
