<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * The api's contract as the boundary reads it: the IR view of the kept operations and the declarations they read,
 * which the generated contract class holds as constant arrays (kept by OPcache between requests), the PHP classes the
 * generator wrote for them, and the routes built once per process.
 */
final class ApiContract
{
    public const NOT_FOUND_ROLE = 'notFound';
    public const UNDECLARED_STATUS_ROLE = 'undeclaredStatus';
    /** The status a result class maps to when it is the operation's errors result. */
    public const ERRORS_RESULT = 0;
    private const HEAD = 'HEAD';
    private const GET = 'GET';

    /** @var array<string, self> */
    private static array $loaded = [];

    /** @var array<string, array<array-key, mixed>> */
    private array $operations = [];
    /** @var list<ContractRoute> */
    private array $routes = [];
    /** @var list<string> */
    private array $basePaths = [];
    /** @var array<string, array{string, int}> each result class and the operation and status it answers */
    private array $resultClasses = [];

    /**
     * @param array<array-key, mixed> $ir
     * @param array<array-key, mixed> $types
     * @param array<string, mixed> $defaults
     * @param list<array<string, mixed>> $routeTable
     */
    private function __construct(
        public readonly string $api,
        public readonly array $ir,
        public readonly array $types,
        public readonly array $defaults,
        public readonly array $routeTable,
        public readonly string $routesClass,
        /** @var list<array{method: ?string, path: string}> */
        public readonly array $frameworkRoutes,
    ) {
        foreach (Ir::maps($ir, 'operations') as $operation) {
            $id = Ir::string($operation, 'id') ?? '';
            $this->operations[$id] = $operation;
            $surface = Ir::string($operation, 'surface') ?? '';
            $basePath = Ir::string(Ir::map(Ir::map(Ir::map($ir, 'api'), 'surfaces'), $surface), 'prefix') ?? '';
            $this->routes[] = ContractRoute::of($operation, $basePath);
            if (!in_array($basePath, $this->basePaths, true)) {
                $this->basePaths[] = $basePath;
            }

            $operationTypes = Ir::map(Ir::map($types, 'operations'), $id);
            foreach (Ir::map($operationTypes, 'responses') as $status => $class) {
                if (is_string($class)) {
                    $this->resultClasses[$class] = [$id, (int) $status];
                }
            }
            $errorsClass = Ir::string($operationTypes, 'errors');
            if ($errorsClass !== null) {
                $this->resultClasses[$errorsClass] = [$id, self::ERRORS_RESULT];
            }
        }
        usort($this->routes, ContractRoute::mostSpecificFirst(...));
    }

    /** The contract of the generated class `$contractClass`, read once per process. */
    public static function of(string $contractClass): self
    {
        if (isset(self::$loaded[$contractClass])) {
            return self::$loaded[$contractClass];
        }

        $constant = static fn (string $name): mixed => constant("{$contractClass}::{$name}");
        $api = $constant('API');
        $ir = $constant('IR');
        $types = $constant('TYPES');
        $routesClass = $constant('ROUTES_CLASS');
        $frameworkRoutes = $constant('FRAMEWORK_ROUTES');
        if (!is_string($api) || !is_array($ir) || !is_array($types) || !is_string($routesClass) || !is_array($frameworkRoutes)) {
            throw new \LogicException("The generated contract class {$contractClass} lacks its API, IR, TYPES, ROUTES_CLASS or FRAMEWORK_ROUTES constant; regenerate it.");
        }

        $defaults = constant("{$routesClass}::DEFAULTS");
        $routeTable = constant("{$routesClass}::ROUTES");
        if (!is_array($defaults) || !is_array($routeTable)) {
            throw new \LogicException("The generated route table {$routesClass} lacks its DEFAULTS or ROUTES constant; regenerate it.");
        }

        /** @var array<string, mixed> $defaults */
        /** @var list<array<string, mixed>> $routeTable */
        /** @var list<array{method: ?string, path: string}> $frameworkRoutes */
        return self::$loaded[$contractClass] = new self($api, $ir, $types, $defaults, $routeTable, $routesClass, $frameworkRoutes);
    }

    /** @return array<array-key, mixed> */
    public function operation(string $operationId): array
    {
        return $this->operations[$operationId] ?? throw new \LogicException("The api '{$this->api}' has no operation '{$operationId}'.");
    }

    /** @return list<string> */
    public function operationIds(): array
    {
        return array_keys($this->operations);
    }

    /** @return list<string> */
    public function basePaths(): array
    {
        return $this->basePaths;
    }

    /** @return array{string, int}|null the operation and status a generated result class answers, status 0 for its errors */
    public function resultOf(object $result): ?array
    {
        return $this->resultClasses[$result::class] ?? null;
    }

    /**
     * Whether a catch-all under one of `$claimingBasePaths` answers paths under one of `$basePaths`: a claiming base
     * path that is empty, equal or a prefix.
     *
     * @param list<string> $claimingBasePaths
     * @param list<string> $basePaths
     */
    public static function basePathsCover(array $claimingBasePaths, array $basePaths): bool
    {
        foreach ($claimingBasePaths as $claimingBasePath) {
            foreach ($basePaths as $basePath) {
                if ($claimingBasePath === '' || $claimingBasePath === $basePath || str_starts_with($basePath, "{$claimingBasePath}/")) {
                    return true;
                }
            }
        }

        return false;
    }

    /** The match of a raw path, or null when the path is under none of the api's base paths. */
    public function match(string $method, string $rawPath): ?RouteMatch
    {
        $underBasePath = false;
        foreach ($this->basePaths as $basePath) {
            if ($basePath === '' || $rawPath === $basePath || str_starts_with($rawPath, "{$basePath}/")) {
                $underBasePath = true;
            }
        }
        if (!$underBasePath) {
            return null;
        }

        $routeMethod = $method === self::HEAD ? self::GET : $method;
        $segments = array_slice(explode('/', $rawPath), 1);
        foreach ($this->routes as $route) {
            $parameters = $route->match($segments);
            if ($parameters !== null && $route->method === $routeMethod) {
                return RouteMatch::operation($route->operationId, $parameters);
            }
        }

        return RouteMatch::unserved();
    }

    /** The code an operation declares for `$role`, or the api's code for it when no operation is given. */
    public function roleCode(?string $operationId, string $role): ?string
    {
        $operations = $operationId === null ? $this->operations : [$this->operation($operationId)];
        foreach ($operations as $operation) {
            foreach (Ir::maps($operation, 'errors') as $error) {
                foreach (Ir::maps($error, 'roles') as $declared) {
                    if (Ir::string($declared, 'role') === $role) {
                        return Ir::string($error, 'code');
                    }
                }
            }
        }

        foreach (Ir::map($this->ir, 'errors') as $code => $catalogued) {
            if (Ir::string($catalogued, 'default') === $role && $operationId !== null && $this->declares($operationId, (string) $code)) {
                return (string) $code;
            }
        }

        return null;
    }

    /** The params template a role binds on one of an operation's codes. */
    public function roleParams(string $operationId, string $code, string $role): mixed
    {
        foreach (Ir::maps($this->operation($operationId), 'errors') as $error) {
            if (Ir::string($error, 'code') !== $code) {
                continue;
            }
            foreach (Ir::maps($error, 'roles') as $declared) {
                if (Ir::string($declared, 'role') === $role) {
                    return $declared['params'] ?? null;
                }
            }
        }

        return null;
    }

    /** @return array<array-key, mixed> the operation's entry for `$code` (its roles and retry header), empty when it declares none */
    public function errorDeclaration(string $operationId, string $code): array
    {
        foreach (Ir::maps($this->operation($operationId), 'errors') as $error) {
            if (Ir::string($error, 'code') === $code) {
                return $error;
            }
        }

        return [];
    }

    public function declares(string $operationId, string $code): bool
    {
        foreach (Ir::maps($this->operation($operationId), 'errors') as $error) {
            if (Ir::string($error, 'code') === $code) {
                return true;
            }
        }

        return false;
    }

    /** @return array<array-key, mixed> */
    public function catalogEntry(string $code): array
    {
        return Ir::map(Ir::map($this->ir, 'errors'), $code);
    }

    public function statusOf(string $code): int
    {
        return Ir::int(Ir::map($this->catalogEntry($code), 'http'), 'status') ?? 500;
    }

    /** @return array<array-key, mixed> the wire format an operation answers in */
    public function format(?string $operationId): array
    {
        $formatId = $operationId === null ? null : Ir::string($this->operation($operationId), 'format');
        $formats = Ir::map($this->ir, 'formats');

        return Ir::map($formats, $formatId ?? (string) array_key_first($formats));
    }

    /** @return array<array-key, mixed> */
    public function declaration(string $kind, string $id): array
    {
        return Ir::map(Ir::map($this->ir, $kind), $id);
    }

    /** @return array<array-key, mixed> */
    public function operationTypes(string $operationId): array
    {
        return Ir::map(Ir::map($this->types, 'operations'), $operationId);
    }

    /**
     * Every generated class the contract names that may hold a request or reply value: the schemas, each operation's
     * input, parameter parts and replies, and each identity's credentials.
     *
     * @return list<string>
     */
    public function valueClasses(): array
    {
        $classes = [];
        foreach (Ir::map($this->types, 'schemas') as $schema) {
            $classes[] = Ir::string($schema, 'class');
        }
        foreach (Ir::map($this->types, 'operations') as $operation) {
            $classes[] = Ir::string($operation, 'input');
            foreach (Ir::map($operation, 'parts') as $part) {
                $classes[] = Ir::string($part, 'class');
            }
            foreach (Ir::map($operation, 'responses') as $response) {
                $classes[] = is_string($response) ? $response : null;
            }
        }
        foreach (Ir::map($this->types, 'identities') as $identity) {
            $classes[] = Ir::string($identity, 'credentials');
        }

        return array_values(array_unique(array_filter($classes, is_string(...))));
    }

    /** The route name the generated registration gives an operation. */
    public function routeName(string $operationId): string
    {
        return "seampact.{$this->api}.{$operationId}";
    }
}
