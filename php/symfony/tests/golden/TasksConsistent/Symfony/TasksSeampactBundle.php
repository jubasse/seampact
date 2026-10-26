<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Symfony\Component\Config\Definition\Configurator\DefinitionConfigurator;
use Symfony\Component\DependencyInjection\Compiler\PassConfig;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

/**
 * The contract's api 'tasks' in a Symfony app, configured under 'seampact_tasks'.
 */
final class TasksSeampactBundle extends AbstractBundle
{
  protected string $extensionAlias = 'seampact_tasks';

  public function configure(DefinitionConfigurator $definition): void
  {
    // Scalar nodes only, so an %env()% placeholder is never refused here; the settings check each value.
    $children = $definition->rootNode()->children();
    $children->scalarNode('responses')->defaultValue('strict');
    $children->scalarNode('body_validation')->defaultValue(false);
    $children->arrayNode('operations')->useAttributeAsKey('operationId')->arrayPrototype()->children()->scalarNode('responses');
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
