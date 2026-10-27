<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\DumpRedaction;
use Seampact\Symfony\Runtime\BootCheckPass;
use Seampact\Symfony\Runtime\BoundarySubscriber;
use Seampact\Symfony\Runtime\ContractSettings;
use Seampact\Symfony\Runtime\HookCheckWarmer;
use Seampact\Symfony\Runtime\Hooks;
use Seampact\Symfony\Runtime\KindRequestMatcher;
use Seampact\Symfony\Runtime\Regeneration;
use Seampact\Symfony\Runtime\RouteCheck;
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
    public const ROUTE_LOADER_SERVICE = 'seampact.tasks.route_loader';
    public const INPUT_RESOLVER_SERVICE = 'seampact.tasks.input_resolver';
    public const SETTINGS_SERVICE = 'seampact.tasks.settings';
    public const HOOKS_SERVICE = 'seampact.tasks.hooks';
    public const BOUNDARY_SERVICE = 'seampact.tasks.boundary';
    public const HOOK_CHECK_WARMER_SERVICE = 'seampact.tasks.hook_check_warmer';
    public const ROUTE_CHECK_SERVICE = 'seampact.tasks.route_check';

    /** The service id the app aliases to the idempotency store of this api. */
    public const IDEMPOTENCY_STORE_SERVICE = Hooks::TAG_PREFIX . 'tasks' . Hooks::IDEMPOTENCY_STORE_SUFFIX;
    private const API = 'tasks';

    protected string $extensionAlias = 'seampact_tasks';

    public function configure(DefinitionConfigurator $definition): void
    {
        // Scalar nodes only, so an %env()% placeholder is never refused here; loadExtension checks each literal.
        $children = $definition->rootNode()->children();
        $children->scalarNode('responses')->defaultValue('strict');
        $children->scalarNode('body_validation')->defaultValue(false);
        $children->scalarNode('public_origin');
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
        $refusals = TasksSettings::literalRefusals($config, $builder);
        if ($refusals !== []) {
            throw new InvalidConfigurationException(implode("\n", $refusals));
        }

        $services = $container->services();
        $services->set(self::ROUTE_LOADER_SERVICE, TasksRouteLoader::class)->tag('routing.loader');
        $services->set(self::INPUT_RESOLVER_SERVICE, TasksInputResolver::class)->tag('controller.argument_value_resolver', ['priority' => TasksInputResolver::PRIORITY]);
        $services->set(self::SETTINGS_SERVICE, TasksSettings::class)->args([
            '$responses' => $config['responses'] ?? null,
            '$bodyValidation' => $config['body_validation'] ?? null,
            '$operations' => $config['operations'] ?? [],
            ContractSettings::PUBLIC_ORIGIN_ARGUMENT => $config['public_origin'] ?? null,
        ]);
        $services->set(self::HOOKS_SERVICE, Hooks::class)->args([
            tagged_locator(Hooks::tag(self::API, Hooks::AUTHENTICATE_TAG_SUFFIX), Hooks::HOOK_ATTRIBUTE),
            tagged_iterator(Hooks::tag(self::API, Hooks::DECIDERS_TAG_SUFFIX)),
            tagged_iterator(Hooks::tag(self::API, Hooks::SCOPE_RESOLVERS_TAG_SUFFIX)),
            service(UnexpectedErrorListener::class)->nullOnInvalid(),
            service('logger'),
            service(self::IDEMPOTENCY_STORE_SERVICE)->nullOnInvalid(),
        ]);
        $services->set(self::BOUNDARY_SERVICE, TasksBoundary::class)->args([service(self::HOOKS_SERVICE), service(self::SETTINGS_SERVICE), service('validator')])->tag('kernel.event_subscriber')->tag(BootCheckPass::BOUNDARY_TAG, [BootCheckPass::CONTRACT_ATTRIBUTE => TasksContract::class]);
        foreach (TasksAccess::KINDS as $kind) {
            $services->set(KindRequestMatcher::serviceId(self::API, $kind), KindRequestMatcher::class)->args([TasksContract::class, TasksAccess::ROUTES, $kind]);
        }
        $builder->registerForAutoconfiguration(Decider::class)->addTag(Hooks::tag(self::API, Hooks::DECIDERS_TAG_SUFFIX));
        $builder->registerForAutoconfiguration(ScopeResolver::class)->addTag(Hooks::tag(self::API, Hooks::SCOPE_RESOLVERS_TAG_SUFFIX));
        $builder->registerForAutoconfiguration(UserAuthenticateHook::class)->addTag(Hooks::tag(self::API, Hooks::AUTHENTICATE_TAG_SUFFIX), [Hooks::HOOK_ATTRIBUTE => UserAuthenticateHook::class]);
        $services->set(self::HOOK_CHECK_WARMER_SERVICE, HookCheckWarmer::class)->args([service(self::HOOKS_SERVICE), TasksContract::class])->tag('kernel.cache_warmer');
        $services->set(self::ROUTE_CHECK_SERVICE, RouteCheck::class)->decorate('routing.loader')->args([service('.inner'), TasksContract::class, TasksRouteLoader::RESOURCE, true]);
    }

    public function build(ContainerBuilder $container): void
    {
        parent::build($container);
        $container->addCompilerPass(new TasksControllerPass(), PassConfig::TYPE_BEFORE_OPTIMIZATION, TasksControllerPass::PRIORITY);
        $container->addCompilerPass(new BootCheckPass(TasksContract::class, SeampactOperation::class, self::BOUNDARY_SERVICE, self::INPUT_RESOLVER_SERVICE, self::SETTINGS_SERVICE, TasksSettings::class, true), PassConfig::TYPE_BEFORE_REMOVING, BootCheckPass::PRIORITY);
    }

    /**
     * Checks the runtime version first, except under the generate command, then redacts credentials in VarDumper
     * and refuses a worker runtime, which serves many requests from one container.
     */
    public function boot(): void
    {
        parent::boot();
        if (!Regeneration::skips(TasksContract::class)) {
            DumpRedaction::register(ApiContract::of(TasksContract::class));
        }
        BoundarySubscriber::refuseWorker($this->container);
    }
}
