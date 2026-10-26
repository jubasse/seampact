<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\PublicOrigin;
use Symfony\Component\DependencyInjection\Argument\ServiceClosureArgument;
use Symfony\Component\DependencyInjection\Compiler\CompilerPassInterface;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Reference;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * The container part of the api's boot check (ADR 0024 "The boot check"), a compiler pass after the event listeners
 * are registered: every problem listed at once, with the fix, then thrown, so no container is written and the app
 * does not serve. It checks the handlers (one service per endpoints interface, each method marked with its operation,
 * no access attribute the boundary would run after the input checks), the boundary's listeners and the value resolver,
 * the listeners placed where the outgoing check cannot see them, an api registered before this one whose catch-all
 * answers this api's paths, ext-zlib, the Symfony major, `framework.http_cache`, and under absolute URLs a
 * `public_origin` in the bundle configuration, whose value the settings check at run time.
 */
final class BootCheckPass implements CompilerPassInterface
{
    /** After Symfony's RegisterListenersPass (priority 0 of the same type), which writes the dispatcher's listeners. */
    public const PRIORITY = -32;
    /** The tag of each api's boundary, whose attribute names the api's contract class. */
    public const BOUNDARY_TAG = 'seampact.boundary';
    public const CONTRACT_ATTRIBUTE = 'contract';
    private const DEBUG_HANDLERS_LISTENER = 'debug.debug_handlers_listener';
    private const HTTP_CACHE = 'http_cache';
    private const VALUE_RESOLVER_TAG = 'controller.argument_value_resolver';
    private const REFUSED_ATTRIBUTES = [
        'Symfony\\Component\\Security\\Http\\Attribute\\IsGranted' => 'an access_control rule or a decider of the right',
        'Symfony\\Component\\Security\\Http\\Attribute\\IsCsrfTokenValid' => 'the authenticate hook with the CSRF companion value',
        'Symfony\\Component\\HttpKernel\\Attribute\\IsSignatureValid' => 'nothing: a signed URI is not a form the contract declares',
    ];
    private const SUPPORTED_MAJORS = ['/^7\.4\./', '/^8\./'];

    /** @param bool $checksHandlers the `handlers` switch of `artefacts.bootCheck` */
    public function __construct(
        private readonly string $contractClass,
        private readonly string $boundaryClass,
        private readonly string $resolverClass,
        private readonly string $settingsClass,
        private readonly bool $checksHandlers,
    ) {
    }

    public function process(ContainerBuilder $container): void
    {
        $contract = ApiContract::of($this->contractClass);
        $problems = [
            ...($this->checksHandlers ? $this->handlers($container, $contract) : []),
            ...$this->listeners($container),
            ...$this->shadowingBoundaries($container, $contract),
            ...$this->platform($container),
            ...$this->publicOrigin($container, $contract),
        ];

        if ($problems !== []) {
            throw new \LogicException("seampact: the api '{$contract->api}' cannot start:\n- " . implode("\n- ", $problems));
        }
    }

    /**
     * The `public_origin` key the api needs under absolute URLs; an `%env()%` value is only known at run time.
     *
     * @return list<string>
     */
    private function publicOrigin(ContainerBuilder $container, ApiContract $contract): array
    {
        $arguments = $container->hasDefinition($this->settingsClass) ? $container->getDefinition($this->settingsClass)->getArguments() : [];
        $configured = $arguments[ContractSettings::PUBLIC_ORIGIN_ARGUMENT] ?? null;
        if ($configured !== null && $configured !== '') {
            return [];
        }

        $aliasConstant = "{$this->settingsClass}::" . ContractSettings::ALIAS_CONSTANT;
        $alias = defined($aliasConstant) ? constant($aliasConstant) : null;
        if (!is_string($alias)) {
            throw new \LogicException("seampact: the generated settings class {$this->settingsClass} lacks its ALIAS constant; regenerate the code.");
        }

        $problem = PublicOrigin::bootProblem($contract, "{$alias}.public_origin", null);

        return $problem === null ? [] : [$problem];
    }

    /** @return list<string> */
    private function handlers(ContainerBuilder $container, ApiContract $contract): array
    {
        $problems = [];
        foreach (self::operationsByInterface($contract) as $interface => $operations) {
            $implementing = self::implementing($container, $interface);
            if (count($implementing) !== 1) {
                $found = $implementing === [] ? 'no service implements it' : 'several services implement it: ' . implode(', ', array_keys($implementing));
                $problems[] = "operation '" . implode("', '", $operations) . "' has no handler: the endpoints interface {$interface} needs exactly one service implementing it, but {$found}; register one controller service implementing it";
                continue;
            }

            $class = array_values($implementing)[0];
            foreach (self::refusedAttributes($class->getAttributes()) as $attribute => $fix) {
                $problems[] = "the controller {$class->name} carries #[{$attribute}], which runs after the contract's input checks; use {$fix}";
            }
            foreach ($operations as $method => $operationId) {
                $problems = [...$problems, ...self::method($class, $method, $operationId)];
            }
        }

        return $problems;
    }

    /**
     * @param \ReflectionClass<object> $class
     * @return list<string>
     */
    private static function method(\ReflectionClass $class, string $method, string $operationId): array
    {
        if (!$class->hasMethod($method)) {
            return [];
        }

        $reflection = $class->getMethod($method);
        $marks = array_map(static fn (\ReflectionAttribute $attribute): mixed => $attribute->getArguments()[0] ?? $attribute->getArguments()['operationId'] ?? null, $reflection->getAttributes(SeampactOperation::class));
        $problems = [];
        if ($marks !== [$operationId]) {
            $problems[] = "the method {$class->name}::{$method} handles operation '{$operationId}' but is not marked #[SeampactOperation('{$operationId}')]; add the attribute";
        }
        foreach (self::refusedAttributes($reflection->getAttributes()) as $attribute => $fix) {
            $problems[] = "the method {$class->name}::{$method} carries #[{$attribute}], which runs after the contract's input checks; use {$fix}";
        }

        return $problems;
    }

    /**
     * @param list<\ReflectionAttribute<object>> $attributes
     * @return array<string, string> each refused attribute found, with its fix
     */
    private static function refusedAttributes(array $attributes): array
    {
        $refused = [];
        foreach ($attributes as $attribute) {
            $fix = self::REFUSED_ATTRIBUTES[$attribute->getName()] ?? null;
            if ($fix !== null) {
                $refused[$attribute->getName()] = $fix;
            }
        }

        return $refused;
    }

    /** @return list<string> */
    private function listeners(ContainerBuilder $container): array
    {
        $problems = [];
        if (!$container->hasDefinition($this->resolverClass) || !$container->getDefinition($this->resolverClass)->hasTag(self::VALUE_RESOLVER_TAG)) {
            $problems[] = "the input resolver {$this->resolverClass} is not registered as a value resolver; list the api's bundle in config/bundles.php";
        }

        $boundaryListeners = [];
        foreach (self::dispatcherListeners($container) as [$event, $service, $priority]) {
            if ($service === $this->boundaryClass) {
                $boundaryListeners[] = "{$event}@{$priority}";
            } elseif ($event === KernelEvents::REQUEST && $priority > BoundarySubscriber::REQUEST_PRIORITY && $service !== self::DEBUG_HANDLERS_LISTENER) {
                $problems[] = "the service {$service} listens to kernel.request at priority {$priority}, above the boundary's " . BoundarySubscriber::REQUEST_PRIORITY . ', so a reply it sets escapes the contract; lower its priority';
            } elseif ($event === KernelEvents::RESPONSE && $priority < BoundarySubscriber::RESPONSE_PRIORITY) {
                $problems[] = "the service {$service} listens to kernel.response at priority {$priority}, below the boundary's " . BoundarySubscriber::RESPONSE_PRIORITY . ', so a change it makes escapes the outgoing check; raise its priority';
            }
        }

        $expected = [];
        foreach (BoundarySubscriber::getSubscribedEvents() as $event => $listeners) {
            foreach ($listeners as [, $priority]) {
                $expected[] = "{$event}@{$priority}";
            }
        }
        $missing = array_diff($expected, $boundaryListeners);
        if ($missing !== []) {
            $problems[] = "the boundary {$this->boundaryClass} does not listen to " . implode(', ', $missing) . "; keep the api's bundle's subscriber as it is";
        }

        return $problems;
    }

    /**
     * Each api whose boundary runs before this one at the same priority with its catch-all on, under a base path that
     * is empty, equal to or a prefix of one of this api's: it answers its 404 on this api's paths.
     *
     * @return list<string>
     */
    private function shadowingBoundaries(ContainerBuilder $container, ApiContract $contract): array
    {
        $contractClasses = self::boundaryContractClasses($container);
        $problems = [];
        foreach (self::dispatcherListeners($container) as [$event, $service, $priority]) {
            if ($event !== KernelEvents::REQUEST || $priority !== BoundarySubscriber::REQUEST_PRIORITY) {
                continue;
            }
            if ($service === $this->boundaryClass) {
                break;
            }

            $earlierContractClass = $contractClasses[$service] ?? null;
            if ($earlierContractClass === null) {
                continue;
            }

            $earlier = ApiContract::of($earlierContractClass);
            if (($earlier->defaults['catch_all'] ?? true) !== false && ApiContract::basePathsCover($earlier->basePaths(), $contract->basePaths())) {
                $basePaths = implode(', ', array_map(static fn (string $basePath): string => $basePath === '' ? '/' : $basePath, $earlier->basePaths()));
                $problems[] = "the api '{$earlier->api}' registered before this one answers its catch-all 404 under {$basePaths}, which covers this api's paths; set catchAll to false on the api whose base path equals or prefixes this api's";
            }
        }

        return $problems;
    }

    /** @return array<string, string> the contract class of each api's boundary, by service id */
    private static function boundaryContractClasses(ContainerBuilder $container): array
    {
        $contractClasses = [];
        foreach ($container->findTaggedServiceIds(self::BOUNDARY_TAG) as $id => $tags) {
            $attributes = $tags[0] ?? null;
            $contractClass = is_array($attributes) ? ($attributes[self::CONTRACT_ATTRIBUTE] ?? null) : null;
            if (is_string($contractClass)) {
                $contractClasses[$id] = $contractClass;
            }
        }

        return $contractClasses;
    }

    /** @return list<string> */
    private function platform(ContainerBuilder $container): array
    {
        $problems = [];
        if (!extension_loaded('zlib')) {
            $problems[] = 'the PHP extension zlib is not loaded; the boundary decodes gzip and deflate bodies with it';
        }

        $supported = array_filter(self::SUPPORTED_MAJORS, static fn (string $major): bool => preg_match($major, Kernel::VERSION) === 1);
        if ($supported === []) {
            $problems[] = 'Symfony ' . Kernel::VERSION . ' is not supported; use Symfony 7.4 or 8';
        }

        if ($container->hasDefinition(self::HTTP_CACHE) && $container->getDefinition(self::HTTP_CACHE)->isPublic()) {
            $problems[] = 'framework.http_cache is on, and a reply HttpCache serves from its store never reaches the boundary; turn it off';
        }

        return $problems;
    }

    /** @return array<string, array<string, string>> each endpoints interface's methods and their operation ids */
    private static function operationsByInterface(ApiContract $contract): array
    {
        $interfaces = [];
        foreach ($contract->routeTable as $route) {
            $controller = $route['controller'] ?? null;
            $operation = $route['operation'] ?? null;
            if (is_array($controller) && is_string($controller[0] ?? null) && is_string($controller[1] ?? null) && is_string($operation)) {
                $interfaces[$controller[0]][$controller[1]] = $operation;
            }
        }

        return $interfaces;
    }

    /** @return array<string, \ReflectionClass<object>> the services implementing `$interface`, by id */
    private static function implementing(ContainerBuilder $container, string $interface): array
    {
        $implementing = [];
        foreach ($container->getDefinitions() as $id => $definition) {
            if ($definition->isAbstract()) {
                continue;
            }

            $class = $container->getParameterBag()->resolveValue($definition->getClass() ?? $id);
            $reflection = is_string($class) ? $container->getReflectionClass($class, false) : null;
            if ($reflection !== null && !$reflection->isInterface() && $reflection->implementsInterface($interface)) {
                $implementing[$id] = $reflection;
            }
        }

        return $implementing;
    }

    /** @return list<array{string, string, int}> each listener on the event dispatcher: its event, service id and priority */
    private static function dispatcherListeners(ContainerBuilder $container): array
    {
        if (!$container->hasDefinition('event_dispatcher')) {
            return [];
        }

        $listeners = [];
        foreach ($container->getDefinition('event_dispatcher')->getMethodCalls() as $call) {
            $method = is_array($call) ? ($call[0] ?? null) : null;
            $arguments = is_array($call) ? ($call[1] ?? null) : null;
            if (!is_array($arguments)) {
                continue;
            }

            $callable = $arguments[1] ?? null;
            $closure = is_array($callable) ? ($callable[0] ?? null) : null;
            $reference = $closure instanceof ServiceClosureArgument ? ($closure->getValues()[0] ?? null) : null;
            if ($method !== 'addListener' || !is_string($arguments[0] ?? null) || !$reference instanceof Reference) {
                continue;
            }

            $priority = $arguments[2] ?? 0;
            $listeners[] = [$arguments[0], (string) $reference, is_int($priority) ? $priority : 0];
        }

        return $listeners;
    }
}
