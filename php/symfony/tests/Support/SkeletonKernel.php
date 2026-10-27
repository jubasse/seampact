<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Golden\TasksConsistent\Symfony\TasksSeampactBundle;
use Seampact\Symfony\Runtime\BootCheckPass;
use Symfony\Bundle\FrameworkBundle\FrameworkBundle;
use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;

/**
 * An app laid out as the Symfony skeleton is, with the generated tree under its own namespace: the skeleton's
 * `services.yaml` loads every class of `src/` with autowiring and autoconfiguration on, so the golden tree is loaded
 * the same way, next to its bundle.
 */
final class SkeletonKernel extends Kernel
{
    use MicroKernelTrait;

    private const GOLDEN_NAMESPACE = 'Seampact\\Golden\\TasksConsistent\\';
    private const GOLDEN_DIRECTORY = __DIR__ . '/../golden/TasksConsistent/';
    /** Public aliases of two services the bundle wires, so the compiled container keeps them for the test to read. */
    public const BOUNDARY_ALIAS = 'test.boundary';
    public const WARMER_ALIAS = 'test.hook_check_warmer';

    public function __construct(private readonly string $workDirectory)
    {
        parent::__construct('test', false);
    }

    public function registerBundles(): iterable
    {
        yield new FrameworkBundle();
        yield new TasksSeampactBundle();
    }

    public function getProjectDir(): string
    {
        return $this->workDirectory;
    }

    public function getCacheDir(): string
    {
        return $this->workDirectory . '/var/cache';
    }

    public function getLogDir(): string
    {
        return $this->workDirectory . '/var/log';
    }

    /** The container as `cache:clear` compiles it, before it is dumped. */
    public function compiledContainer(): ContainerBuilder
    {
        $this->initializeBundles();
        $container = $this->buildContainer();
        $container->compile();

        return $container;
    }

    // The boot check refuses the golden api's missing handlers; its own refusals are covered by BootCheckPassTest.
    protected function build(ContainerBuilder $container): void
    {
        $passConfig = $container->getCompilerPassConfig();
        $passConfig->setBeforeRemovingPasses(array_values(array_filter(
            $passConfig->getBeforeRemovingPasses(),
            static fn (CompilerPassInterface $pass): bool => !$pass instanceof BootCheckPass,
        )));
    }

    protected function configureContainer(ContainerConfigurator $container): void
    {
        $container->extension('framework', [
            'secret' => 'seampact-test',
            'http_method_override' => false,
            'handle_all_throwables' => true,
            'php_errors' => ['log' => true],
            'validation' => ['enabled' => true],
        ]);
        $container->extension('seampact_tasks', ['public_origin' => 'https://api.example.com']);

        $services = $container->services();
        $services->defaults()->autowire()->autoconfigure()->load(self::GOLDEN_NAMESPACE, self::GOLDEN_DIRECTORY);
        $services->alias(self::BOUNDARY_ALIAS, TasksSeampactBundle::BOUNDARY_SERVICE)->public();
        $services->alias(self::WARMER_ALIAS, TasksSeampactBundle::HOOK_CHECK_WARMER_SERVICE)->public();
    }

    protected function configureRoutes(RoutingConfigurator $routes): void
    {
    }
}
