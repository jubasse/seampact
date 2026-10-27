<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Foundation\Application;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\Laravel\TasksBoundary;
use Seampact\Golden\Tasks\Laravel\TasksSeampactServiceProvider;
use Seampact\Golden\TasksConsistent\Laravel\TasksBoundary as ConsistentBoundary;
use Seampact\Golden\TasksConsistent\Laravel\TasksSeampactServiceProvider as ConsistentProvider;
use Seampact\Laravel\Runtime\ContractServiceProvider;

/**
 * Two apis in one app: each boundary leads the global stack when only the other api's boundary comes before it, and
 * that boundary does not claim its paths with its catch-all on.
 */
final class BoundaryPlacementTest extends TestCase
{
    private const OTHER_MIDDLEWARE = 'Illuminate\\Http\\Middleware\\TrustProxies';

    public function testEachApisBoundaryLeadsWhenOnlyTheOtherBoundaryPrecedesIt(): void
    {
        $app = self::appWithBothApis();
        // Both golden apis serve the same base paths, so the earlier one passes only with its catch-all off.
        self::config($app)->set('seampact.tasks.catch_all', false);
        $global = [ConsistentBoundary::class, TasksBoundary::class, self::OTHER_MIDDLEWARE];

        self::assertTrue(ContractServiceProvider::leadsGlobalStack($app, $global, ConsistentBoundary::class));
        self::assertTrue(ContractServiceProvider::leadsGlobalStack($app, $global, TasksBoundary::class));
    }

    public function testABoundaryAfterAnotherGlobalMiddlewareDoesNotLead(): void
    {
        $app = self::appWithBothApis();

        self::assertFalse(ContractServiceProvider::leadsGlobalStack($app, [self::OTHER_MIDDLEWARE, TasksBoundary::class], TasksBoundary::class));
        self::assertFalse(ContractServiceProvider::leadsGlobalStack($app, [ConsistentBoundary::class, self::OTHER_MIDDLEWARE], TasksBoundary::class));
    }

    public function testAnEarlierBoundaryClaimingTheSameBasePathsWithItsCatchAllOnDoesNotLetItLead(): void
    {
        $app = self::appWithBothApis();

        self::assertFalse(ContractServiceProvider::leadsGlobalStack($app, [ConsistentBoundary::class, TasksBoundary::class], TasksBoundary::class));
        self::assertTrue(ContractServiceProvider::leadsGlobalStack($app, [ConsistentBoundary::class, TasksBoundary::class], ConsistentBoundary::class));
    }

    private static function config(Application $app): Repository
    {
        $config = $app->make('config');
        self::assertInstanceOf(Repository::class, $config);

        return $config;
    }

    private static function appWithBothApis(): Application
    {
        $app = new Application(sys_get_temp_dir());
        $app->instance('config', new Repository());
        (new TasksSeampactServiceProvider($app))->register();
        (new ConsistentProvider($app))->register();

        return $app;
    }
}
