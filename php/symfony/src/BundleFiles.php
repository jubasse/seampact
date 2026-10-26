<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Dumper;
use Nette\PhpGenerator\Literal;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\TargetOptions;

/**
 * The api's bundle (ADR 0024 "Options and registration"), which the app lists in `config/bundles.php`: its
 * configuration under `seampact_<api>` (`responses`, `body_validation` and `operations.<operationId>.responses`, all
 * scalar nodes, defaulting to the target options), its services (the route loader, the input resolver and the
 * settings that read that configuration), and the compiler pass that points each endpoints interface at the one
 * service implementing it.
 */
final class BundleFiles
{
    public function __construct(
        private readonly SymfonyPlacement $placement,
        private readonly TargetOptions $options,
    ) {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        return [$this->bundle(), $this->controllerPass(), $this->settings()];
    }

    private function bundle(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->bundle);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->setExtends($file->type('Symfony\\Component\\HttpKernel\\Bundle\\AbstractBundle'))
            ->addComment("The contract's api '{$this->placement->apiKey}' in a Symfony app, configured under '{$this->placement->configurationAlias}'.");
        $class->addProperty('extensionAlias', $this->placement->configurationAlias)->setProtected()->setType('string');

        $configure = $class->addMethod('configure')->setPublic()->setReturnType('void');
        $configure->addParameter('definition')->setType($file->type('Symfony\\Component\\Config\\Definition\\Configurator\\DefinitionConfigurator'));
        $configure->setBody((new Dumper())->format(
            <<<'PHP'
                // Scalar nodes only, so an %env()% placeholder is never refused here; the settings check each value.
                $children = $definition->rootNode()->children();
                $children->scalarNode('responses')->defaultValue(?);
                $children->scalarNode('body_validation')->defaultValue(?);
                $children->arrayNode('operations')->useAttributeAsKey('operationId')->arrayPrototype()->children()->scalarNode('responses');
                PHP,
            $this->options->responses->value,
            $this->options->bodyValidation,
        ));

        $load = $class->addMethod('loadExtension')->setPublic()->setReturnType('void');
        $load->addComment('@param array<mixed> $config');
        $load->addParameter('config')->setType('array');
        $load->addParameter('container')->setType($file->type('Symfony\\Component\\DependencyInjection\\Loader\\Configurator\\ContainerConfigurator'));
        $load->addParameter('builder')->setType($file->type('Symfony\\Component\\DependencyInjection\\ContainerBuilder'));
        $routeLoader = $file->name($this->placement->routeLoader);
        $resolver = $file->name($this->placement->inputResolver);
        $settings = $file->name($this->placement->settings);
        $load->setBody(<<<PHP
            \$services = \$container->services();
            \$services->set({$routeLoader}::class)->tag('routing.loader');
            \$services->set({$resolver}::class)->tag('controller.argument_value_resolver', ['priority' => {$resolver}::PRIORITY]);
            \$services->set({$settings}::class)->args([\$config['responses'] ?? null, \$config['body_validation'] ?? null, \$config['operations'] ?? []]);
            PHP);

        $build = $class->addMethod('build')->setPublic()->setReturnType('void');
        $build->addParameter('container')->setType($file->type('Symfony\\Component\\DependencyInjection\\ContainerBuilder'));
        $pass = $file->name($this->placement->controllerPass);
        $passConfig = $file->name('Symfony\\Component\\DependencyInjection\\Compiler\\PassConfig');
        $build->setBody(<<<PHP
            parent::build(\$container);
            \$container->addCompilerPass(new {$pass}(), {$passConfig}::TYPE_BEFORE_OPTIMIZATION, {$pass}::PRIORITY);
            PHP);

        return $file;
    }

    private function controllerPass(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->controllerPass);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->addImplement($file->type('Symfony\\Component\\DependencyInjection\\Compiler\\CompilerPassInterface'))
            ->addComment("Points each endpoints interface at the one service implementing it, a controller the routes name by\n"
                . 'the interface; an interface that no service, or several, implement is left to the boot check, which refuses it.');
        // Before Symfony's controller argument pass (priority 0), which reads the `controller.service_arguments` tag.
        $class->addConstant('PRIORITY', 1);

        $endpoints = [];
        foreach ($this->placement->operations() as [, $operation]) {
            $endpoints[$this->placement->names($operation->id)->endpoints] = true;
        }
        $listed = array_map(static fn (string $interface): string => $file->name($interface) . '::class', array_keys($endpoints));
        $class->addConstant('ENDPOINTS', new Literal('[' . implode(', ', $listed) . ']'))->setPrivate();

        $process = $class->addMethod('process')->setPublic()->setReturnType('void');
        $process->addParameter('container')->setType($file->type('Symfony\\Component\\DependencyInjection\\ContainerBuilder'));
        $process->setBody(<<<'PHP'
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
            PHP);

        return $file;
    }

    private function settings(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->settings);
        $alias = $this->placement->configurationAlias;
        $class = $file->namespace->addClass($file->shortName)->setFinal()->setReadOnly()
            ->addComment("The '{$alias}' bundle configuration, each value checked when the boundary reads it, so a value\n"
                . 'the configuration cannot hold is refused naming its key and the accepted values, never the value.');
        $class->addConstant('RESPONSES_VALUES', ['strict', 'warn'])->setPrivate();
        $class->addConstant('TRUE_TEXTS', ['true', '1'])->setPrivate();
        $class->addConstant('FALSE_TEXTS', ['false', '0', ''])->setPrivate();

        $constructor = $class->addMethod('__construct')->setPublic();
        $constructor->addComment('@param array<mixed> $operations');
        $constructor->addPromotedParameter('responses')->setPrivate()->setType('mixed');
        $constructor->addPromotedParameter('bodyValidation')->setPrivate()->setType('mixed');
        $constructor->addPromotedParameter('operations')->setPrivate()->setType('array');

        $responses = $class->addMethod('responsesOf')->setPublic()->setReturnType('string')
            ->addComment("The outgoing check's mode of an operation: its own value, else the api's.");
        $responses->addParameter('operationId')->setType('string');
        $responses->setBody(<<<PHP
            \$operation = \$this->operations[\$operationId] ?? null;
            \$own = is_array(\$operation) ? (\$operation['responses'] ?? null) : null;
            \$value = \$own ?? \$this->responses;
            \$key = \$own === null ? '{$alias}.responses' : "{$alias}.operations.{\$operationId}.responses";
            if (!is_string(\$value) || !in_array(\$value, self::RESPONSES_VALUES, true)) {
                throw new \\UnexpectedValueException("The bundle configuration key {\$key} takes 'strict' or 'warn'.");
            }

            return \$value;
            PHP);

        $body = $class->addMethod('bodyValidation')->setPublic()->setReturnType('bool')
            ->addComment('Whether the outgoing check validates success bodies; an environment value is text.');
        $body->setBody(<<<PHP
            \$value = \$this->bodyValidation;
            if (is_bool(\$value)) {
                return \$value;
            }

            if (is_string(\$value) && in_array(strtolower(\$value), self::TRUE_TEXTS, true)) {
                return true;
            }

            if (is_string(\$value) && in_array(strtolower(\$value), self::FALSE_TEXTS, true)) {
                return false;
            }

            throw new \\UnexpectedValueException('The bundle configuration key {$alias}.body_validation takes true or false.');
            PHP);

        return $file;
    }
}
