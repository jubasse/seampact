<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Golden\Tasks\Symfony\SeampactOperation as RelativeOperation;
use Seampact\Golden\Tasks\Symfony\TasksBoundary as RelativeBoundary;
use Seampact\Golden\Tasks\Symfony\TasksContract as RelativeContract;
use Seampact\Golden\Tasks\Symfony\TasksSeampactBundle as FirstBundle;
use Seampact\Golden\Tasks\Symfony\TasksSettings as RelativeSettings;
use Seampact\Golden\TasksConsistent\Symfony\SeampactOperation as TasksOperation;
use Seampact\Golden\TasksConsistent\Symfony\TasksContract;
use Seampact\Golden\TasksConsistent\Symfony\TasksSeampactBundle as SecondBundle;
use Seampact\Golden\TasksConsistent\Symfony\TasksSettings;
use Seampact\Symfony\Runtime\BootCheckPass;
use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\Compiler\ResolveClassPass;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\EventDispatcher\DependencyInjection\RegisterListenersPass;
use Symfony\Component\EventDispatcher\EventDispatcher;
use Symfony\Component\HttpKernel\Bundle\Bundle;
use Symfony\Component\HttpKernel\DependencyInjection\MergeExtensionConfigurationPass;

/** The container part of the boot check, run on the golden bundles. */
final class BootCheckPassTest extends TestCase
{
    private const EARLIER_BOUNDARY = 'test.earlier_boundary';
    private const RELATIVE_URLS_REFUSAL = "the api writes relative URLs ('api.wire.urls: relative') and 'seampact_tasks.public_origin' is set";

    public function testAnEarlierApiWhoseCatchAllCoversThisApisBasePathIsRefused(): void
    {
        // Both golden apis serve under `/v1` with their catch-all on, and the first registered answers first.
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->register('event_dispatcher', EventDispatcher::class);
        // Both golden apis are named tasks, so the first one's boundary is registered under an id of its own.
        $container->register(self::EARLIER_BOUNDARY, RelativeBoundary::class)
            ->addTag('kernel.event_subscriber')
            ->addTag(BootCheckPass::BOUNDARY_TAG, [BootCheckPass::CONTRACT_ATTRIBUTE => RelativeContract::class]);
        self::load(new SecondBundle(), $container);
        (new ResolveClassPass())->process($container);
        (new RegisterListenersPass())->process($container);

        $problems = '';
        try {
            (self::bootCheck())->process($container);
        } catch (\LogicException $failure) {
            $problems = $failure->getMessage();
        }

        self::assertStringContainsString("the api 'tasks' registered before this one answers its catch-all 404 under /v1", $problems);
        // The second golden api writes absolute URLs and its configuration sets no public_origin.
        self::assertStringContainsString("'seampact_tasks.public_origin' is not set", $problems);
    }

    public function testUnderAbsoluteUrlsAnEnvDrivenPublicOriginPassesAtBuild(): void
    {
        $problems = self::compiledProblems(new SecondBundle(), '%env(TASKS_PUBLIC_ORIGIN)%', self::bootCheck());

        self::assertStringNotContainsString('public_origin', $problems);
    }

    public function testUnderAbsoluteUrlsALiteralPublicOriginThatIsNotAnOriginIsRefusedAtBuild(): void
    {
        $problems = self::compiledProblems(new SecondBundle(), 'https://api.example.com/v1', self::bootCheck());

        self::assertStringContainsString("'seampact_tasks.public_origin' is 'https://api.example.com/v1'", $problems);
    }

    public function testUnderRelativeUrlsAPublicOriginThatIsSetIsRefusedAtBuild(): void
    {
        $problems = self::compiledProblems(new FirstBundle(), 'https://api.example.com', self::relativeBootCheck());

        self::assertStringContainsString(self::RELATIVE_URLS_REFUSAL, $problems);
    }

    public function testUnderRelativeUrlsAnEnvDrivenPublicOriginIsRefusedAtBuild(): void
    {
        $problems = self::compiledProblems(new FirstBundle(), '%env(TASKS_PUBLIC_ORIGIN)%', self::relativeBootCheck());

        self::assertStringContainsString(self::RELATIVE_URLS_REFUSAL, $problems);
    }

    public function testUnderRelativeUrlsAnUnsetPublicOriginPasses(): void
    {
        self::assertStringNotContainsString('public_origin', self::compiledProblems(new FirstBundle(), null, self::relativeBootCheck()));
    }

    public function testAContainerWithoutTheValidatorIsRefusedNamingThePackage(): void
    {
        self::assertStringContainsString('install symfony/validator', self::compiledProblems(new FirstBundle(), null, self::relativeBootCheck()));
    }

    private static function bootCheck(): BootCheckPass
    {
        return new BootCheckPass(TasksContract::class, TasksOperation::class, SecondBundle::BOUNDARY_SERVICE, SecondBundle::INPUT_RESOLVER_SERVICE, SecondBundle::SETTINGS_SERVICE, TasksSettings::class, false);
    }

    private static function relativeBootCheck(): BootCheckPass
    {
        return new BootCheckPass(RelativeContract::class, RelativeOperation::class, FirstBundle::BOUNDARY_SERVICE, FirstBundle::INPUT_RESOLVER_SERVICE, FirstBundle::SETTINGS_SERVICE, RelativeSettings::class, false);
    }

    /** The boot check's problems on a container built as a Kernel builds it, the bundle configuration merged first. */
    private static function compiledProblems(Bundle $bundle, ?string $publicOrigin, CompilerPassInterface $bootCheck): string
    {
        $container = new ContainerBuilder();
        $container->setParameter('kernel.environment', 'test');
        $container->setParameter('kernel.build_dir', sys_get_temp_dir());
        $container->register('event_dispatcher', EventDispatcher::class);
        $extension = $bundle->getContainerExtension();
        self::assertNotNull($extension);
        $container->registerExtension($extension);
        $container->loadFromExtension($extension->getAlias(), $publicOrigin === null ? [] : ['public_origin' => $publicOrigin]);
        (new MergeExtensionConfigurationPass([$extension->getAlias()]))->process($container);
        (new ResolveClassPass())->process($container);
        (new RegisterListenersPass())->process($container);

        try {
            $bootCheck->process($container);
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
