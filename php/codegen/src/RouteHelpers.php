<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Nette\PhpGenerator\ClassType;
use Nette\PhpGenerator\Method;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\OpaqueTypeUse;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\Param;
use Seampact\Ir\Model\RefTypeUse;

/**
 * The route helpers of one api on the PHP targets (ADR 0023 and 0024 "Routes"), beside the contract class:
 * `<Api>RouteNames`, one constant per operation holding the route name the target registers
 * (`seampact.<api>.<operationId>`), and `<Api>Urls`, one static method per operation building the contract's path from
 * one typed argument per path parameter, in path order, each value encoded as one segment by the runtime's
 * `WireValues::pathSegment`. The artefact switch `routeHelpers: false` leaves both out.
 */
final class RouteHelpers
{
    private const WIRE_VALUES = 'WireValues';

    private readonly string $routeNamesClass;
    private readonly string $urlsClass;

    public function __construct(private readonly BoundaryNames $names, private readonly PhpTypes $types, private readonly Refusals $refusals)
    {
        $layout = $names->layout();
        $namespace = PhpClassFile::namespaceOf($names->contractClass());
        $apiName = IrPlace::root()->below('api', 'name');
        $this->routeNamesClass = $layout->claim("{$namespace}\\{$layout->apiTypeName}RouteNames", "the api's route names", $apiName);
        $this->urlsClass = $layout->claim("{$namespace}\\{$layout->apiTypeName}Urls", "the api's URL builders", $apiName);
    }

    /** The route name a PHP target registers for an operation, as the runtime's `ApiContract::routeName` reads it. */
    public static function routeName(string $apiId, string $operationId): string
    {
        return "seampact.{$apiId}.{$operationId}";
    }

    /**
     * @param list<array{int, Operation}> $operations the kept operations with their index in the IR
     * @return list<PhpClassFile>
     */
    public function files(array $operations): array
    {
        $apiId = $this->names->layout()->ir->api->id;

        $routeNames = new PhpClassFile($this->routeNamesClass);
        $routeNamesType = $routeNames->namespace->addClass($routeNames->shortName)->setFinal()
            ->addComment("The route name of each operation of api '{$apiId}', as the target registers it.");

        $urls = new PhpClassFile($this->urlsClass);
        $urlsType = $urls->namespace->addClass($urls->shortName)->setFinal()
            ->addComment("The path of each operation of api '{$apiId}', as the contract defines it.")
            ->addComment('')
            ->addComment('Each path value is encoded as one segment. The path carries no prefix of the route group or import serving it,')
            ->addComment('and stays a path when the api writes absolute URLs: the router builds a full URL from the route name.');

        foreach ($operations as [$index, $operation]) {
            $operationNames = $this->names->layout()->operation($operation->id);
            if ($operationNames === null) {
                continue;
            }

            $routeNamesType->addConstant(self::constantName($operation), self::routeName($apiId, $operation->id))->setPublic()
                ->addComment("The route of operation '{$operation->id}', `" . strtoupper($operation->method->value) . " {$operation->path}`.");
            $this->addUrlMethod($urls, $urlsType, $operation, $operationNames->method, IrPlace::ofOperation($index, $operation->id));
        }

        return [$routeNames, $urls];
    }

    private function addUrlMethod(PhpClassFile $file, ClassType $class, Operation $operation, string $methodName, IrPlace $at): void
    {
        $method = $class->addMethod($methodName)->setStatic()->setReturnType('string')
            ->addComment("The path of operation '{$operation->id}', `{$operation->path}`.");
        $wireValues = $file->name($this->names->runtime(self::WIRE_VALUES));
        $parameters = [];
        foreach ($operation->params->path as $position => $param) {
            $parameters[$param->name] = [$position, $param];
        }

        $parts = [];
        $literal = '';
        foreach (explode('/', $operation->path) as $segmentIndex => $segment) {
            $literal .= $segmentIndex === 0 ? '' : '/';
            if (preg_match(RoutePlaceholder::PLACEHOLDER_SEGMENT, $segment) !== 1) {
                $literal .= $segment;
                continue;
            }

            $wireName = substr($segment, 1, -1);
            if (!isset($parameters[$wireName])) {
                $this->refusals->inconsistent('path.param.missing', "The path placeholder '{$segment}' names no path parameter", $at->below('path'));

                return;
            }
            [$position, $param] = $parameters[$wireName];
            $variable = $this->addParameter($file, $method, $param, $at->below('params', 'path', $position));
            if ($variable === null) {
                return;
            }

            $parts[] = var_export($literal, true);
            $parts[] = "{$wireValues}::pathSegment(" . var_export($wireName, true) . ", \${$variable})";
            $literal = '';
        }
        $parts[] = var_export($literal, true);
        $written = array_values(array_filter($parts, static fn (string $part): bool => $part !== "''"));

        $method->setBody('return ' . ($written === [] ? "''" : implode(' . ', $written)) . ';');
    }

    /** The parameter's variable name, or null when its type is refused. */
    private function addParameter(PhpClassFile $file, Method $method, Param $param, IrPlace $at): ?string
    {
        $variable = PhpNames::memberIdentifier($param->name);
        if ($variable === null) {
            return null;
        }

        if ($param->type instanceof ArrayTypeUse || $param->type instanceof RefTypeUse || $param->type instanceof OpaqueTypeUse) {
            $this->refusals->add(
                'routeHelpers.param.unsupported',
                "The path parameter '{$param->name}' is a {$param->type->tag()} value, which the URL builder does not write as one segment.",
                "Give the parameter a scalar or enum type, or switch the route helpers off with `artefacts: { routeHelpers: false }`.",
                $at,
            );

            return null;
        }

        $type = $this->types->of($param->type, $file);
        $method->addParameter($variable)->setType($type->native);

        return $variable;
    }

    /** `GET_TASK` for operation `getTask`: its name's segments, upper-cased and joined by `_`. */
    private static function constantName(Operation $operation): string
    {
        return strtoupper(implode('_', $operation->name->segments));
    }
}
