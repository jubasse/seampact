<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Bundle\AbstractBundle;

/**
 * The bundle of `seampact/symfony`'s console command, which the app lists in `config/bundles.php` for the `dev`
 * environment only (`Seampact\Symfony\SeampactCommandsBundle::class => ['dev' => true]`), since the package is a
 * development dependency.
 */
final class SeampactCommandsBundle extends AbstractBundle
{
    /** @param array<mixed> $config */
    public function loadExtension(array $config, ContainerConfigurator $container, ContainerBuilder $builder): void
    {
        $container->services()->set(GenerateCommand::class)->args(['%kernel.project_dir%'])->tag('console.command');
    }
}
