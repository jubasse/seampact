<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\Symfony\TasksSeampactBundle as FirstBundle;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\BootCheckPass;
use Seampact\Golden\TasksConsistent\Symfony\TasksBoundary;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksInputResolver;
use Seampact\Golden\TasksConsistent\Symfony\TasksSeampactBundle as SecondBundle;
use Symfony\Component\DependencyInjection\Compiler\ResolveClassPass;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\EventDispatcher\DependencyInjection\RegisterListenersPass;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\HttpKernel\Bundle\Bundle;

/** The container part of the boot check, run on the golden bundles. */
final class BootCheckPassTest extends TestCase
{
    public function testAnEarlierApiWhoseCatchAllCoversThisApisBasePathIsRefused(): void
    {
        // Both golden apis serve under `/v1` with their catch-all on, and the first registered answers first.
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->register('event_dispatcher', EventDispatcher::class);
        self::load(new FirstBundle(), $container);
        self::load(new SecondBundle(), $container);
        (new ResolveClassPass())->process($container);
        (new RegisterListenersPass())->process($container);

        $problems = '';
        try {
            (new BootCheckPass(TasksContract::class, TasksBoundary::class, TasksInputResolver::class, false))->process($container);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("the api 'tasks' registered before this one answers its catch-all 404 under /v1", $problems);
    }

    private static function load(Bundle $bundle, ContainerBuilder $container): void
    {
        $extension = $bundle->getContainerExtension();
        self::assertNotNull($extension);
        $extension->load([], $container);
    }
}
