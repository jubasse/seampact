<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\ApiContract;
use Seampact\Golden\Tasks\Symfony\Runtime\BootCheckPass;
use Seampact\Golden\Tasks\Symfony\Runtime\BoundarySubscriber;
use Seampact\Golden\Tasks\Symfony\Runtime\Decider;
use Seampact\Golden\Tasks\Symfony\Runtime\DumpRedaction;
use Seampact\Golden\Tasks\Symfony\Runtime\HookCheckWarmer;
use Seampact\Golden\Tasks\Symfony\Runtime\Hooks;
use Seampact\Golden\Tasks\Symfony\Runtime\RouteCheck;
use Seampact\Golden\Tasks\Symfony\Runtime\ScopeResolver;
use Seampact\Golden\Tasks\Symfony\Runtime\UnexpectedErrorListener;
use Seampact\Hooks\IdempotencyStore;
use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;
use function Symfony\Component\DependencyInjection\Loader\Configurator\tagged_iterator;
use function Symfony\Component\DependencyInjection\Loader\Configurator\tagged_locator;

/**
 * The contract's api 'tasks' in a Symfony app, configured under 'seampact_tasks'.
 */
final class TasksSeampactBundle extends AbstractBundle
{
    /** @var list<string> */
    private const OPERATION_IDS = ['getChannel', 'getDraft', 'getTask', 'getTasksBatch', 'health'];
    private const API = 'tasks';

    protected string $extensionAlias = 'seampact_tasks';

    public function configure(DefinitionConfigurator $definition): void
    {
        // Scalar nodes only, so an %env()% placeholder is never refused here; the settings check each value.
        $children = $definition->rootNode()->children();
        $children->scalarNode('responses')->defaultValue('strict');
        $children->scalarNode('body_validation')->defaultValue(false);
        // An operation id the api does not declare, such as a typo, fails the container build.
        $children->arrayNode('operations')->useAttributeAsKey('operationId')
            ->validate()
            ->ifTrue(static fn (array $operations): bool => array_diff(array_keys($operations), self::OPERATION_IDS) !== [])
            ->then(static function (array $operations): never {
                $unknown = implode("', '", array_diff(array_keys($operations), self::OPERATION_IDS));
                throw new InvalidConfigurationException("The bundle configuration key seampact_tasks.operations names '{$unknown}', not an operation of the api; it takes '" . implode("', '", self::OPERATION_IDS) . "'.");
            })
            ->end()
            ->arrayPrototype()->children()->scalarNode('responses');
    }

    /**
     * @param array<mixed> $config
     */
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $services = $container->services();
        $services->set(TasksRouteLoader::class)->tag('routing.loader');
        $services->set(TasksInputResolver::class)->tag('controller.argument_value_resolver', ['priority' => TasksInputResolver::PRIORITY]);
        $services->set(TasksSettings::class)->args([$config['responses'] ?? null, $config['body_validation'] ?? null, $config['operations'] ?? []]);
        $services->set(Hooks::class)->args([
            tagged_locator(Hooks::tag(self::API, Hooks::AUTHENTICATE_TAG_SUFFIX), Hooks::HOOK_ATTRIBUTE),
            tagged_iterator(Hooks::tag(self::API, Hooks::DECIDERS_TAG_SUFFIX)),
            tagged_iterator(Hooks::tag(self::API, Hooks::SCOPE_RESOLVERS_TAG_SUFFIX)),
            service(UnexpectedErrorListener::class)->nullOnInvalid(),
            service('logger'),
            service(IdempotencyStore::class)->nullOnInvalid(),
        ]);
        $services->set(TasksBoundary::class)->args([service(Hooks::class), service(TasksSettings::class), service('validator')])->tag('kernel.event_subscriber');
        $builder->registerForAutoconfiguration(Decider::class)->addTag(Hooks::tag(self::API, Hooks::DECIDERS_TAG_SUFFIX));
        $builder->registerForAutoconfiguration(ScopeResolver::class)->addTag(Hooks::tag(self::API, Hooks::SCOPE_RESOLVERS_TAG_SUFFIX));
        $builder->registerForAutoconfiguration(UserAuthenticateHook::class)->addTag(Hooks::tag(self::API, Hooks::AUTHENTICATE_TAG_SUFFIX), [Hooks::HOOK_ATTRIBUTE => UserAuthenticateHook::class]);
        $services->set(HookCheckWarmer::class)->args([service(Hooks::class), TasksContract::class])->tag('kernel.cache_warmer');
        $services->set(RouteCheck::class)->decorate('routing.loader')->args([service('.inner'), TasksContract::class, TasksRouteLoader::RESOURCE, true]);
    }

    public function build(ContainerBuilder $container): void
    {
        parent::build($container);
        $container->addCompilerPass(new TasksControllerPass(), PassConfig::TYPE_BEFORE_OPTIMIZATION, TasksControllerPass::PRIORITY);
        $container->addCompilerPass(new BootCheckPass(TasksContract::class, TasksBoundary::class, TasksInputResolver::class, true), PassConfig::TYPE_BEFORE_REMOVING, BootCheckPass::PRIORITY);
    }

    /**
     * Refuses a worker runtime, which serves many requests from one container, and redacts credentials in VarDumper.
     */
    public function boot(): void
    {
        parent::boot();
        BoundarySubscriber::refuseWorker($this->container);
        DumpRedaction::register(ApiContract::of(TasksContract::class));
    }
}
