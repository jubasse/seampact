<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

/**
 * The contract's api 'tasks' in a Symfony app, configured under 'seampact_tasks'.
 */
final class TasksSeampactBundle extends AbstractBundle
{
    /** @var list<string> */
    private const OPERATION_IDS = ['getChannel', 'getDraft', 'getTask', 'getTasksBatch', 'health'];

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
    }

    public function build(ContainerBuilder $container): void
    {
        parent::build($container);
        $container->addCompilerPass(new TasksControllerPass(), PassConfig::TYPE_BEFORE_OPTIMIZATION, TasksControllerPass::PRIORITY);
    }
}
