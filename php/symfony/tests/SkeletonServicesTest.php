<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\HookCheckWarmer;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\RouteCheck;
use Seampact\Golden\TasksConsistent\Symfony\TasksBoundary;
use Seampact\Symfony\Tests\Support\SkeletonKernel;
use Symfony\Component\Filesystem\Filesystem;

/** The generated tree under the Symfony skeleton's `services.yaml`, which loads every class of `src/` as a service. */
final class SkeletonServicesTest extends TestCase
{
    private string $workDirectory;

    protected function setUp(): void
    {
        $this->workDirectory = sys_get_temp_dir() . '/seampact-skeleton-' . bin2hex(random_bytes(6));
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->workDirectory);
    }

    public function testTheContainerBuildsAndKeepsTheServicesTheBundleWires(): void
    {
        $container = (new SkeletonKernel($this->workDirectory))->compiledContainer();

        self::assertTrue($container->getDefinition(TasksBoundary::class)->hasTag('kernel.event_subscriber'));
        self::assertTrue($container->has(HookCheckWarmer::class));
        self::assertTrue($container->has(RouteCheck::class));
    }
}
