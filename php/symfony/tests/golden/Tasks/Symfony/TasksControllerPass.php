<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\ChannelsEndpoints;
use Seampact\Golden\Tasks\DraftsEndpoints;
use Seampact\Golden\Tasks\TasksEndpoints;
use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * Points each endpoints interface at the one service implementing it, a controller the routes name by
 * the interface; an interface that no service, or several, implement is left to the boot check, which refuses it.
 */
final class TasksControllerPass implements CompilerPassInterface
{
    public const PRIORITY = 1;
    private const ENDPOINTS = [ChannelsEndpoints::class, DraftsEndpoints::class, TasksEndpoints::class, AppEndpoints::class];

    public function process(ContainerBuilder $container): void
    {
        foreach (self::ENDPOINTS as $interface) {
            $implementing = [];
            foreach ($container->getDefinitions() as $id => $definition) {
                if ($definition->isAbstract()) {
                    continue;
                }

                $class = $container->getParameterBag()->resolveValue($definition->getClass() ?? $id);
                $reflection = is_string($class) ? $container->getReflectionClass($class, false) : null;
                if ($reflection !== null && $reflection->implementsInterface($interface)) {
                    $implementing[] = $id;
                }
            }

            if (count($implementing) !== 1) {
                continue;
            }

            $container->getDefinition($implementing[0])->addTag('controller.service_arguments');
            $container->setAlias($interface, $implementing[0])->setPublic(true);
        }
    }
}
