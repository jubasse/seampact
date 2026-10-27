<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\Dumper;
use Nette\PhpGenerator\Literal;
use Seampact\Codegen\BootCheckSwitches;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Model\UrlForm;

/**
 * The api's bundle (ADR 0024 "Options and registration"), which the app lists in `config/bundles.php`: its
 * configuration under `seampact_<api>` (`responses`, `body_validation` and `operations.<operationId>.responses`, all
 * scalar nodes, defaulting to the target options, a literal outside its values failing the container build), its
 * services under `seampact.<api>.<role>` ids (the route loader, the input resolver, the settings
 * that read that configuration, the hooks, the boundary subscriber and the boot check's route decorator), the
 * autoconfiguration tags of the hook interfaces, the compiler passes that point each endpoints interface at the one
 * service implementing it and run the boot check, and the worker refusal of its `boot()`; then the boundary subscriber
 * itself, naming the api's classes.
 */
final class BundleFiles
{
    private const IDEMPOTENCY_STORE = 'Seampact\\Hooks\\IdempotencyStore';
    /** The bundle's constants naming the id of each service it registers, and the role ending the id. */
    private const SERVICE_ROLES = [
        'ROUTE_LOADER_SERVICE' => 'route_loader',
        'INPUT_RESOLVER_SERVICE' => 'input_resolver',
        'SETTINGS_SERVICE' => 'settings',
        'HOOKS_SERVICE' => 'hooks',
        'BOUNDARY_SERVICE' => 'boundary',
        'HOOK_CHECK_WARMER_SERVICE' => 'hook_check_warmer',
        'ROUTE_CHECK_SERVICE' => 'route_check',
    ];

    public function __construct(
        private readonly SymfonyPlacement $placement,
        private readonly TargetOptions $options,
        private readonly ?BootCheckSwitches $bootCheck,
    ) {
    }

    /** @return list<PhpClassFile> */
    public function files(): array
    {
        return [$this->bundle(), $this->controllerPass(), $this->settings(), $this->boundary(), (new AccessTableFile($this->placement))->file()];
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
        // Ids that are not class names, so an app's resource import of the generated classes never replaces them.
        foreach (self::SERVICE_ROLES as $constant => $role) {
            $class->addConstant($constant, "seampact.{$this->placement->layout->ir->api->id}.{$role}");
        }

        $configure = $class->addMethod('configure')->setPublic()->setReturnType('void');
        $configure->addParameter('definition')->setType($file->type('Symfony\\Component\\Config\\Definition\\Configurator\\DefinitionConfigurator'));
        $invalid = $file->name('Symfony\\Component\\Config\\Definition\\Exception\\InvalidConfigurationException');
        $configure->setBody(str_replace(['__INVALID__', '__ALIAS__'], [$invalid, $this->placement->configurationAlias], (new Dumper())->format(
            <<<'PHP'
                // Scalar nodes only, so an %env()% placeholder is never refused here; loadExtension checks each literal.
                $children = $definition->rootNode()->children();
                $children->scalarNode('responses')->defaultValue(?);
                $children->scalarNode('body_validation')->defaultValue(?);
                $children->scalarNode('public_origin');
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
        $idempotencyStore = $file->name(self::IDEMPOTENCY_STORE);
        $decider = $file->name($this->placement->runtime('Decider'));
        $scopeResolver = $file->name($this->placement->runtime('ScopeResolver'));
        $routeCheck = $file->name($this->placement->runtime('RouteCheck'));
        $contract = $file->name($this->placement->contract);
        $bootCheck = $file->name($this->placement->runtime('BootCheckPass'));
        $publicOriginArgument = "\n    {$file->name($this->placement->runtime('ContractSettings'))}::PUBLIC_ORIGIN_ARGUMENT => \$config['public_origin'] ?? null,";
        $matcher = $file->name($this->placement->runtime('KindRequestMatcher'));
        $access = $file->name($this->placement->access);
        $tag = static fn (string $suffix): string => "{$hooks}::tag(self::API, {$hooks}::{$suffix})";
        $body = <<<PHP
            \$refusals = {$settings}::literalRefusals(\$config, \$builder);
            if (\$refusals !== []) {
                throw new {$file->name('Symfony\\Component\\Config\\Definition\\Exception\\InvalidConfigurationException')}(implode("\\n", \$refusals));
            }

            \$services = \$container->services();
            \$services->set(self::ROUTE_LOADER_SERVICE, {$routeLoader}::class)->tag('routing.loader');
            \$services->set(self::INPUT_RESOLVER_SERVICE, {$resolver}::class)->tag('controller.argument_value_resolver', ['priority' => {$resolver}::PRIORITY]);
            \$services->set(self::SETTINGS_SERVICE, {$settings}::class)->args([
                '\$responses' => \$config['responses'] ?? null,
                '\$bodyValidation' => \$config['body_validation'] ?? null,
                '\$operations' => \$config['operations'] ?? [],{$publicOriginArgument}
            ]);
            \$services->set(self::HOOKS_SERVICE, {$hooks}::class)->args([
                tagged_locator({$tag('AUTHENTICATE_TAG_SUFFIX')}, {$hooks}::HOOK_ATTRIBUTE),
                tagged_iterator({$tag('DECIDERS_TAG_SUFFIX')}),
                tagged_iterator({$tag('SCOPE_RESOLVERS_TAG_SUFFIX')}),
                service({$listener}::class)->nullOnInvalid(),
                service('logger'),
                service({$idempotencyStore}::class)->nullOnInvalid(),
            ]);
            \$services->set(self::BOUNDARY_SERVICE, {$boundary}::class)->args([service(self::HOOKS_SERVICE), service(self::SETTINGS_SERVICE), service('validator')])->tag('kernel.event_subscriber')->tag({$bootCheck}::BOUNDARY_TAG, [{$bootCheck}::CONTRACT_ATTRIBUTE => {$contract}::class]);
            foreach ({$access}::KINDS as \$kind) {
                \$services->set({$matcher}::serviceId(self::API, \$kind), {$matcher}::class)->args([{$contract}::class, {$access}::ROUTES, \$kind]);
            }
            \$builder->registerForAutoconfiguration({$decider}::class)->addTag({$tag('DECIDERS_TAG_SUFFIX')});
            \$builder->registerForAutoconfiguration({$scopeResolver}::class)->addTag({$tag('SCOPE_RESOLVERS_TAG_SUFFIX')});

            PHP;
        foreach ($this->placement->identities() as $classes) {
            $hook = $file->name($classes['hook']);
            $body .= "\$builder->registerForAutoconfiguration({$hook}::class)->addTag({$tag('AUTHENTICATE_TAG_SUFFIX')}, [{$hooks}::HOOK_ATTRIBUTE => {$hook}::class]);\n";
        }
        if ($this->bootCheck !== null && $this->bootCheck->hooks) {
            $warmer = $file->name($this->placement->runtime('HookCheckWarmer'));
            $body .= "\$services->set(self::HOOK_CHECK_WARMER_SERVICE, {$warmer}::class)->args([service(self::HOOKS_SERVICE), {$contract}::class])->tag('kernel.cache_warmer');\n";
        }
        if ($this->bootCheck !== null) {
            $body .= "\$services->set(self::ROUTE_CHECK_SERVICE, {$routeCheck}::class)->decorate('routing.loader')->args([service('.inner'), {$contract}::class, {$routeLoader}::RESOURCE, " . var_export($this->bootCheck->frameworkRoutes, true) . ']);';
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
            $buildBody .= "\n\$container->addCompilerPass(new {$bootCheckPass}({$contract}::class, self::BOUNDARY_SERVICE, self::INPUT_RESOLVER_SERVICE, self::SETTINGS_SERVICE, {$settings}::class, "
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
        $class = BundleWiredClass::excludeFromResourceLoading($file, $file->namespace->addClass($file->shortName))->setFinal()->setReadOnly()
            ->addImplement($file->type($this->placement->runtime('ContractSettings')))
            ->addComment("The '{$alias}' bundle configuration, a literal value checked at the container build\n"
                . "and an `%env()%` one when the boundary reads it, so a value the configuration cannot hold is refused\n"
                . 'naming its key and the accepted values, never the value.');
        $class->addConstant('ALIAS', $alias);
        $class->addConstant('RESPONSES_VALUES', ['strict', 'warn'])->setPrivate();
        $class->addConstant('TRUE_TEXTS', ['true', '1'])->setPrivate();
        $class->addConstant('FALSE_TEXTS', ['false', '0', ''])->setPrivate();

        $constructor = $class->addMethod('__construct')->setPublic();
        $constructor->addComment('@param array<mixed> $operations');
        $constructor->addPromotedParameter('responses')->setPrivate()->setType('mixed');
        $constructor->addPromotedParameter('bodyValidation')->setPrivate()->setType('mixed');
        $constructor->addPromotedParameter('operations')->setPrivate()->setType('array');
        $originParameter = $this->writesAbsoluteUrls() ? $constructor->addPromotedParameter('publicOrigin') : $constructor->addPromotedParameter('publicOrigin', null);
        $originParameter->setPrivate()->setType('mixed');

        $class->addConstant('BODY_VALIDATION_REFUSAL', "The bundle configuration key {$alias}.body_validation takes true or false.")->setPrivate();

        $literals = $class->addMethod('literalRefusals')->setPublic()->setStatic()->setReturnType('array')
            ->addComment("The refusal of each literal value outside its values, for the container build; an `%env()%` value is\n"
                . "left to the run-time check.\n\n@param array<mixed> \$config\n@return list<string>");
        $literals->addParameter('config')->setType('array');
        $literals->addParameter('container')->setType($file->type('Symfony\\Component\\DependencyInjection\\ContainerBuilder'));
        $envValue = $file->name($this->placement->runtime('EnvValue'));
        $literals->setBody(<<<PHP
            \$literals = ['{$alias}.responses' => \$config['responses'] ?? null];
            \$operations = \$config['operations'] ?? [];
            foreach (is_array(\$operations) ? \$operations : [] as \$operationId => \$operation) {
                if (is_array(\$operation) && (\$operation['responses'] ?? null) !== null) {
                    \$literals["{$alias}.operations.{\$operationId}.responses"] = \$operation['responses'];
                }
            }

            \$refusals = [];
            foreach (\$literals as \$key => \$value) {
                if (self::responsesValue(\$value) === null && !{$envValue}::isPlaceholder(\$container, \$value)) {
                    \$refusals[] = self::responsesRefusal(\$key);
                }
            }

            \$bodyValidation = \$config['body_validation'] ?? null;
            if (self::bodyValidationOf(\$bodyValidation) === null && !{$envValue}::isPlaceholder(\$container, \$bodyValidation)) {
                \$refusals[] = self::BODY_VALIDATION_REFUSAL;
            }

            return \$refusals;
            PHP);

        $responses = $class->addMethod('responsesOf')->setPublic()->setReturnType('string')
            ->addComment("The outgoing check's mode of an operation: its own value, else the api's.");
        $responses->addParameter('operationId')->setType('string');
        $responses->setBody(<<<PHP
            \$operation = \$this->operations[\$operationId] ?? null;
            \$own = is_array(\$operation) ? (\$operation['responses'] ?? null) : null;
            \$value = \$own ?? \$this->responses;
            \$key = \$own === null ? '{$alias}.responses' : "{$alias}.operations.{\$operationId}.responses";

            return self::responsesValue(\$value) ?? throw new \\UnexpectedValueException(self::responsesRefusal(\$key));
            PHP);

        $body = $class->addMethod('bodyValidation')->setPublic()->setReturnType('bool')
            ->addComment('Whether the outgoing check validates success bodies; an environment value is text.');
        $body->setBody(<<<'PHP'
            return self::bodyValidationOf($this->bodyValidation) ?? throw new \UnexpectedValueException(self::BODY_VALIDATION_REFUSAL);
            PHP);

        $responsesValue = $class->addMethod('responsesValue')->setPrivate()->setStatic()->setReturnType('?string')
            ->addComment('The mode, or null for a value outside the modes.');
        $responsesValue->addParameter('value')->setType('mixed');
        $responsesValue->setBody(<<<'PHP'
            return is_string($value) && in_array($value, self::RESPONSES_VALUES, true) ? $value : null;
            PHP);

        $responsesRefusal = $class->addMethod('responsesRefusal')->setPrivate()->setStatic()->setReturnType('string');
        $responsesRefusal->addParameter('key')->setType('string');
        $responsesRefusal->setBody(<<<'PHP'
            return "The bundle configuration key {$key} takes 'strict' or 'warn'.";
            PHP);

        $bodyValidationOf = $class->addMethod('bodyValidationOf')->setPrivate()->setStatic()->setReturnType('?bool')
            ->addComment('A boolean, or its text as an environment value gives it; null for any other value.');
        $bodyValidationOf->addParameter('value')->setType('mixed');
        $bodyValidationOf->setBody(<<<'PHP'
            if (is_bool($value)) {
                return $value;
            }

            if (is_string($value) && in_array(strtolower($value), self::TRUE_TEXTS, true)) {
                return true;
            }

            if (is_string($value) && in_array(strtolower($value), self::FALSE_TEXTS, true)) {
                return false;
            }

            return null;
            PHP);

        $origin = $class->addMethod('publicOrigin')->setPublic()->setReturnType($this->writesAbsoluteUrls() ? 'string' : '?string');
        if (!$this->writesAbsoluteUrls()) {
            $origin->addComment('The api writes relative URLs, so no origin is set, as the boot check requires.');
            $origin->setBody(<<<PHP
                if (\$this->publicOrigin !== null && \$this->publicOrigin !== '') {
                    throw new \\UnexpectedValueException('The bundle configuration key {$alias}.public_origin is set, but the api writes relative URLs: remove it, or set api.wire.urls: absolute in the contract.');
                }

                return null;
                PHP);

            return $file;
        }

        $publicOrigin = $file->name($this->placement->runtime('PublicOrigin'));
        $origin->addComment('The origin absolute URLs start with, never read from the request.');
        $origin->setBody(<<<PHP
            \$origin = \$this->publicOrigin;
            if (!is_string(\$origin) || !{$publicOrigin}::isOrigin(\$origin)) {
                throw new \\UnexpectedValueException('The bundle configuration key {$alias}.public_origin takes the origin clients call: a scheme (http or https), a host and an optional port, such as https://api.example.com.');
            }

            return \$origin;
            PHP);

        return $file;
    }

    private function boundary(): PhpClassFile
    {
        $file = new PhpClassFile($this->placement->boundary);
        $class = BundleWiredClass::excludeFromResourceLoading($file, $file->namespace->addClass($file->shortName))->setFinal()
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

    private function writesAbsoluteUrls(): bool
    {
        return $this->placement->layout->ir->api->wire->urls->value === UrlForm::Absolute;
    }
}
