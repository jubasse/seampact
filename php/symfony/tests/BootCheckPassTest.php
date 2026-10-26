<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\Symfony\TasksSeampactBundle as FirstBundle;
use Seampact\Golden\Tasks\Symfony\Runtime\BootCheckPass as RelativeBootCheckPass;
use Seampact\Golden\Tasks\Symfony\TasksBoundary as RelativeBoundary;
use Seampact\Golden\Tasks\Symfony\TasksContract as RelativeContract;
use Seampact\Golden\Tasks\Symfony\TasksInputResolver as RelativeInputResolver;
use Seampact\Golden\Tasks\Symfony\TasksSettings as RelativeSettings;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\BootCheckPass;
use Seampact\Golden\TasksConsistent\Symfony\TasksBoundary;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksInputResolver;
use Seampact\Golden\TasksConsistent\Symfony\TasksSeampactBundle as SecondBundle;
use Seampact\Golden\TasksConsistent\Symfony\TasksSettings;
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
            (new BootCheckPass(TasksContract::class, TasksBoundary::class, TasksInputResolver::class, TasksSettings::class, false))->process($container);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("the api 'tasks' registered before this one answers its catch-all 404 under /v1", $problems);
        // The second golden api writes absolute URLs and its configuration sets no public_origin.
        self::assertStringContainsString("'seampact_tasks.public_origin' is not set", $problems);
    }

    public function testUnderAbsoluteUrlsAConfiguredPublicOriginPassesWhateverItsEnvValue(): void
    {
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->register('event_dispatcher', EventDispatcher::class);
        $extension = (new SecondBundle())->getContainerExtension();
        self::assertNotNull($extension);
        $extension->load([['public_origin' => '%env(SEAMPACT_TASKS_PUBLIC_ORIGIN)%']], $container);
        (new ResolveClassPass())->process($container);
        (new RegisterListenersPass())->process($container);

        $problems = '';
        try {
            (new BootCheckPass(TasksContract::class, TasksBoundary::class, TasksInputResolver::class, TasksSettings::class, false))->process($container);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringNotContainsString('public_origin', $problems);
    }

    public function testUnderAbsoluteUrlsALiteralPublicOriginThatIsNotAnOriginIsRefusedAtBuild(): void
    {
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->register('event_dispatcher', EventDispatcher::class);
        $extension = (new SecondBundle())->getContainerExtension();
        self::assertNotNull($extension);
        $extension->load([['public_origin' => 'https://api.example.com/v1']], $container);
        (new ResolveClassPass())->process($container);
        (new RegisterListenersPass())->process($container);

        $problems = '';
        try {
            (new BootCheckPass(TasksContract::class, TasksBoundary::class, TasksInputResolver::class, TasksSettings::class, false))->process($container);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("'seampact_tasks.public_origin' is 'https://api.example.com/v1'", $problems);
    }

    public function testUnderRelativeUrlsAPublicOriginThatIsSetIsRefusedAtBuild(): void
    {
        $problems = $this->relativeApiProblems('https://api.example.com');

        self::assertStringContainsString("the api writes relative URLs ('api.wire.urls: relative') and 'seampact_tasks.public_origin' is set", $problems);
    }

    public function testUnderRelativeUrlsAnEnvDrivenPublicOriginIsNotSeenAtBuild(): void
    {
        self::assertStringNotContainsString('public_origin', $this->relativeApiProblems('%env(TASKS_PUBLIC_ORIGIN)%'));
    }

    private function relativeApiProblems(string $publicOrigin): string
    {
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->register('event_dispatcher', EventDispatcher::class);
        $extension = (new FirstBundle())->getContainerExtension();
        self::assertNotNull($extension);
        $extension->load([['public_origin' => $publicOrigin]], $container);
        (new ResolveClassPass())->process($container);
        (new RegisterListenersPass())->process($container);

        try {
            (new RelativeBootCheckPass(RelativeContract::class, RelativeBoundary::class, RelativeInputResolver::class, RelativeSettings::class, false))->process($container);
        } catch (\LogicException $failure) {
            return $failure->getMessage();
        }

        return '';
    }

    private static function load(Bundle $bundle, ContainerBuilder $container): void
    {
        $extension = $bundle->getContainerExtension();
        self::assertNotNull($extension);
        $extension->load([], $container);
    }
}
