<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\BootCheckPass;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\BoundarySubscriber;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ContractSettings;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Decider;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\DumpRedaction;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\HookCheckWarmer;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\KindRequestMatcher;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\RouteCheck;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\ScopeResolver;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\UnexpectedErrorListener;
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
  private const OPERATION_IDS = [
    'createTask',
    'getChannel',
    'getDraft',
    'getPreferences',
    'getTask',
    'getTasksBatch',
    'health',
    'listTasks',
    'payments',
    'purgeTask',
    'searchTasks',
    'updateTask',
  ];

  public const ROUTE_LOADER_SERVICE = 'seampact.tasks.route_loader';
  public const INPUT_RESOLVER_SERVICE = 'seampact.tasks.input_resolver';
  public const SETTINGS_SERVICE = 'seampact.tasks.settings';
  public const HOOKS_SERVICE = 'seampact.tasks.hooks';
  public const BOUNDARY_SERVICE = 'seampact.tasks.boundary';
  public const HOOK_CHECK_WARMER_SERVICE = 'seampact.tasks.hook_check_warmer';
  public const ROUTE_CHECK_SERVICE = 'seampact.tasks.route_check';
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
        service(IdempotencyStore::class)->nullOnInvalid(),
    ]);
    $services->set(self::BOUNDARY_SERVICE, TasksBoundary::class)->args([service(self::HOOKS_SERVICE), service(self::SETTINGS_SERVICE), service('validator')])->tag('kernel.event_subscriber')->tag(BootCheckPass::BOUNDARY_TAG, [BootCheckPass::CONTRACT_ATTRIBUTE => TasksContract::class]);
    foreach (TasksAccess::KINDS as $kind) {
        $services->set(KindRequestMatcher::serviceId(self::API, $kind), KindRequestMatcher::class)->args([TasksContract::class, TasksAccess::ROUTES, $kind]);
    }
    $builder->registerForAutoconfiguration(Decider::class)->addTag(Hooks::tag(self::API, Hooks::DECIDERS_TAG_SUFFIX));
    $builder->registerForAutoconfiguration(ScopeResolver::class)->addTag(Hooks::tag(self::API, Hooks::SCOPE_RESOLVERS_TAG_SUFFIX));
    $builder->registerForAutoconfiguration(StripeAuthenticateHook::class)->addTag(Hooks::tag(self::API, Hooks::AUTHENTICATE_TAG_SUFFIX), [Hooks::HOOK_ATTRIBUTE => StripeAuthenticateHook::class]);
    $builder->registerForAutoconfiguration(UserAuthenticateHook::class)->addTag(Hooks::tag(self::API, Hooks::AUTHENTICATE_TAG_SUFFIX), [Hooks::HOOK_ATTRIBUTE => UserAuthenticateHook::class]);
    $services->set(self::HOOK_CHECK_WARMER_SERVICE, HookCheckWarmer::class)->args([service(self::HOOKS_SERVICE), TasksContract::class])->tag('kernel.cache_warmer');
    $services->set(self::ROUTE_CHECK_SERVICE, RouteCheck::class)->decorate('routing.loader')->args([service('.inner'), TasksContract::class, TasksRouteLoader::RESOURCE, true]);
  }

  public function build(ContainerBuilder $container): void
  {
    parent::build($container);
    $container->addCompilerPass(new TasksControllerPass(), PassConfig::TYPE_BEFORE_OPTIMIZATION, TasksControllerPass::PRIORITY);
    $container->addCompilerPass(new BootCheckPass(TasksContract::class, self::BOUNDARY_SERVICE, self::INPUT_RESOLVER_SERVICE, self::SETTINGS_SERVICE, TasksSettings::class, true), PassConfig::TYPE_BEFORE_REMOVING, BootCheckPass::PRIORITY);
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
