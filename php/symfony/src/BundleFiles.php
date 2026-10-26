<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Dumper;
use Nette\PhpGenerator\Literal;
use Seampact\Codegen\BootCheckSwitches;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\TargetOptions;

/**
 * The api's bundle (ADR 0024 "Options and registration"), which the app lists in `config/bundles.php`: its
 * configuration under `seampact_<api>` (`responses`, `body_validation` and `operations.<operationId>.responses`, all
 * scalar nodes, defaulting to the target options), its services (the route loader, the input resolver, the settings
 * that read that configuration, the hooks, the boundary subscriber and the boot check's route decorator), the
 * autoconfiguration tags of the hook interfaces, the compiler passes that point each endpoints interface at the one
 * service implementing it and run the boot check, and the worker refusal of its `boot()`; then the boundary subscriber
 * itself, naming the api's classes.
 */
final class BundleFiles
{
    public function __construct(
        private readonly SymfonyPlacement $placement,
        private readonly TargetOptions $options,
        private readonly ?BootCheckSwitches $bootCheck,
    ) {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        return [$this->bundle(), $this->controllerPass(), $this->settings(), $this->boundary()];
    }

    private function bundle(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->bundle);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->setExtends($file->type('Symfony\\Component\\HttpKernel\\Bundle\\AbstractBundle'))
            ->addComment("The contract's api '{$this->placement->apiKey}' in a Symfony app, configured under '{$this->placement->configurationAlias}'.");
        $class->addProperty('extensionAlias', $this->placement->configurationAlias)->setProtected()->setType('string');

        $operationIds = array_map(static fn (array $kept): string => $kept[1]->id, $this->placement->operations());
        $class->addConstant('OPERATION_IDS', $operationIds)->setPrivate()->addComment('@var list<string>');

        $configure = $class->addMethod('configure')->setPublic()->setReturnType('void');
        $configure->addParameter('definition')->setType($file->type('Symfony\\Component\\Config\\Definition\\Configurator\\DefinitionConfigurator'));
        $invalid = $file->name('Symfony\\Component\\Config\\Definition\\Exception\\InvalidConfigurationException');
        $configure->setBody(str_replace(['__INVALID__', '__ALIAS__'], [$invalid, $this->placement->configurationAlias], (new Dumper())->format(
            <<<'PHP'
                // Scalar nodes only, so an %env()% placeholder is never refused here; the settings check each value.
                $children = $definition->rootNode()->children();
                $children->scalarNode('responses')->defaultValue(?);
                $children->scalarNode('body_validation')->defaultValue(?);
                // An operation id the api does not declare, such as a typo, fails the container build.
                $children->arrayNode('operations')->useAttributeAsKey('operationId')
                    ->validate()
                    ->ifTrue(static fn (array $operations): bool => array_diff(array_keys($operations), self::OPERATION_IDS) !== [])
                    ->then(static function (array $operations): never {
                        $unknown = implode("', '", array_diff(array_keys($operations), self::OPERATION_IDS));
                        throw new __INVALID__("The bundle configuration key __ALIAS__.operations names '{$unknown}', not an operation of the api; it takes '" . implode("', '", self::OPERATION_IDS) . "'.");
                    })
                    ->end()
                    ->arrayPrototype()->children()->scalarNode('responses');
                PHP,
            $this->options->responses->value,
            $this->options->bodyValidation,
        )));

        $load = $class->addMethod('loadExtension')->setPublic()->setReturnType('void');
        $load->addComment('@param array<mixed> $config');
        $load->addParameter('config')->setType('array');
        $load->addParameter('container')->setType($file->type('Symfony\\Component\\DependencyInjection\\Loader\\Configurator\\ContainerConfigurator'));
        $load->addParameter('builder')->setType($file->type('Symfony\\Component\\DependencyInjection\\ContainerBuilder'));
        $configurator = 'Symfony\\Component\\DependencyInjection\\Loader\\Configurator';
        foreach (['service', 'tagged_iterator', 'tagged_locator'] as $function) {
            $file->namespace->addUseFunction("{$configurator}\\{$function}");
        }
        $routeLoader = $file->name($this->placement->routeLoader);
        $resolver = $file->name($this->placement->inputResolver);
        $settings = $file->name($this->placement->settings);
        $hooks = $file->name($this->placement->runtime('Hooks'));
        $boundary = $file->name($this->placement->boundary);
        $listener = $file->name($this->placement->runtime('UnexpectedErrorListener'));
        $decider = $file->name($this->placement->runtime('Decider'));
        $scopeResolver = $file->name($this->placement->runtime('ScopeResolver'));
        $routeCheck = $file->name($this->placement->runtime('RouteCheck'));
        $contract = $file->name($this->placement->contract);
        $tag = static fn (string $suffix): string => "{$hooks}::tag(self::API, {$hooks}::{$suffix})";
        $body = <<<PHP
            \$services = \$container->services();
            \$services->set({$routeLoader}::class)->tag('routing.loader');
            \$services->set({$resolver}::class)->tag('controller.argument_value_resolver', ['priority' => {$resolver}::PRIORITY]);
            \$services->set({$settings}::class)->args([\$config['responses'] ?? null, \$config['body_validation'] ?? null, \$config['operations'] ?? []]);
            \$services->set({$hooks}::class)->args([
                tagged_locator({$tag('AUTHENTICATE_TAG_SUFFIX')}, {$hooks}::HOOK_ATTRIBUTE),
                tagged_iterator({$tag('DECIDERS_TAG_SUFFIX')}),
                tagged_iterator({$tag('SCOPE_RESOLVERS_TAG_SUFFIX')}),
                service({$listener}::class)->nullOnInvalid(),
                service('logger'),
            ]);
            \$services->set({$boundary}::class)->args([service({$hooks}::class), service({$settings}::class), service('validator')])->tag('kernel.event_subscriber');
            \$builder->registerForAutoconfiguration({$decider}::class)->addTag({$tag('DECIDERS_TAG_SUFFIX')});
            \$builder->registerForAutoconfiguration({$scopeResolver}::class)->addTag({$tag('SCOPE_RESOLVERS_TAG_SUFFIX')});

            PHP;
        foreach ($this->placement->identities() as $classes) {
            $hook = $file->name($classes['hook']);
            $body .= "\$builder->registerForAutoconfiguration({$hook}::class)->addTag({$tag('AUTHENTICATE_TAG_SUFFIX')}, [{$hooks}::HOOK_ATTRIBUTE => {$hook}::class]);\n";
        }
        if ($this->bootCheck !== null && $this->bootCheck->hooks) {
            $warmer = $file->name($this->placement->runtime('HookCheckWarmer'));
            $body .= "\$services->set({$warmer}::class)->args([service({$hooks}::class), {$contract}::class])->tag('kernel.cache_warmer');\n";
        }
        if ($this->bootCheck !== null) {
            $body .= "\$services->set({$routeCheck}::class)->decorate('routing.loader')->args([service('.inner'), {$contract}::class, " . var_export($this->bootCheck->frameworkRoutes, true) . ']);';
        }
        $load->setBody(rtrim($body));
        $class->addConstant('API', $this->placement->layout->ir->api->id)->setPrivate();

        $build = $class->addMethod('build')->setPublic()->setReturnType('void');
        $build->addParameter('container')->setType($file->type('Symfony\\Component\\DependencyInjection\\ContainerBuilder'));
        $pass = $file->name($this->placement->controllerPass);
        $passConfig = $file->name('Symfony\\Component\\DependencyInjection\\Compiler\\PassConfig');
        $buildBody = <<<PHP
            parent::build(\$container);
            \$container->addCompilerPass(new {$pass}(), {$passConfig}::TYPE_BEFORE_OPTIMIZATION, {$pass}::PRIORITY);
            PHP;
        if ($this->bootCheck !== null) {
            $bootCheckPass = $file->name($this->placement->runtime('BootCheckPass'));
            $buildBody .= "\n\$container->addCompilerPass(new {$bootCheckPass}({$contract}::class, {$boundary}::class, {$resolver}::class, "
                . var_export($this->bootCheck->handlers, true) . "), {$passConfig}::TYPE_BEFORE_REMOVING, {$bootCheckPass}::PRIORITY);";
        }
        $build->setBody($buildBody);

        $class->addMethod('boot')->setPublic()->setReturnType('void')
            ->addComment('Refuses a worker runtime, which serves many requests from one container, and redacts credentials in VarDumper.')
            ->setBody("parent::boot();\n{$file->name($this->placement->runtime('BoundarySubscriber'))}::refuseWorker(\$this->container);\n"
                . "{$file->name($this->placement->runtime('DumpRedaction'))}::register({$file->name($this->placement->runtime('ApiContract'))}::of({$file->name($this->placement->contract)}::class));");

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
            ->addImplement($file->type($this->placement->runtime('ContractSettings')))
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

    private function boundary(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->boundary);
        $class = $file->namespace->addClass($file->shortName)->setFinal()
            ->setExtends($file->type($this->placement->runtime('BoundarySubscriber')))
            ->addComment("The boundary of api '{$this->placement->apiKey}', which the bundle registers as an event subscriber.");
        $class->addMethod('contractClass')->setProtected()->setReturnType('string')
            ->setBody('return ' . $file->name($this->placement->contract) . '::class;');

        $arms = [];
        foreach ($this->placement->operations() as [, $operation]) {
            $arms[] = var_export($operation->id, true) . ' => new ' . $file->name($this->placement->inputConstraint($operation->id)) . '(),';
        }
        $arms[] = 'default => throw new \\LogicException("seampact: the api ' . "'{$this->placement->apiKey}'" . ' has no operation \'{$operationId}\'."),';
        $constraint = $class->addMethod('inputConstraint')->setProtected()->setReturnType($file->type('Symfony\\Component\\Validator\\Constraint'))
            ->setBody("return match (\$operationId) {\n\t" . implode("\n\t", $arms) . "\n};");
        $constraint->addParameter('operationId')->setType('string');

        $class->addMethod('inputAttribute')->setProtected()->setReturnType('string')
            ->setBody('return ' . $file->name($this->placement->inputResolver) . '::INPUT_ATTRIBUTE;');
        $class->addMethod('contractExceptionClass')->setProtected()->setReturnType('string')
            ->setBody('return ' . $file->name($this->placement->layout->contractException) . '::class;');
        $class->addMethod('checksHooks')->setProtected()->setReturnType('bool')
            ->setBody('return ' . var_export($this->bootCheck !== null && $this->bootCheck->hooks, true) . ';');

        return $file;
    }
}
