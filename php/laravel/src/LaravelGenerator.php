<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\PsrPrinter;
use Seampact\Codegen\ArtefactSwitches;
use Seampact\Codegen\BootCheckSwitches;
use Seampact\Codegen\ContractClass;
use Seampact\Codegen\ContractExceptions;
use Seampact\Codegen\Delivery;
use Seampact\Codegen\FrameworkRouteScope;
use Seampact\Codegen\HandlerAccessPlacement;
use Seampact\Codegen\HandlerAccessTypes;
use Seampact\Codegen\IdentityTypes;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationTypes;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RestrictedSortKeys;
use Seampact\Codegen\RouteHelpers;
use Seampact\Codegen\SchemaTypes;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Ir\Write\GeneratedFile;

/**
 * The laravel target (ADR 0023), which `vendor/bin/seampact` finds through `extra.seampact.generator`: per api, the
 * value types, the controller interfaces, the results and exceptions replying through the boundary, the FormRequests
 * with their rules, the route table (and `routes.php` under `routes: file`), the route names and URL builders, the
 * contract class, the identity hooks, the middleware, the service provider and the unexpected-error listener interface.
 */
final class LaravelGenerator implements Generator
{
    public const TARGET = 'laravel';
    public const PACKAGE = 'seampact/laravel';
    private const HTTP_OPERATION = 'httpOperation';
    // Laravel's exception handler does not report a declared error a handler throws.
    private const SHOULDNT_REPORT = 'Illuminate\\Contracts\\Debug\\ShouldntReport';
    private const HOOK_REGISTRATION = 'bind it in the container';
    private const LARAVEL_PACK_LAYER = 'pack:@seampact/pack-laravel';
    // The paging styles of `@seampact/pack-laravel` whose handler answers Laravel's paginator (ADR 0023 "Paging").
    private const PACK_PAGINATORS = [
        'laravelPages' => 'Illuminate\\Contracts\\Pagination\\LengthAwarePaginator',
        'laravelCursor' => 'Illuminate\\Contracts\\Pagination\\CursorPaginator',
    ];

    public function irSupport(): IrSupport
    {
        return new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, [self::HTTP_OPERATION], []);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $options = LaravelOptions::parse($entry->options, $entry->namespace, $entry->id);
        $refusals = new Refusals($entry->id, self::TARGET, self::PACKAGE);

        (new ArtefactSwitches(self::TARGET, null, Delivery::Consumer))->read($entry->artefacts, $refusals);

        $kept = new KeptForms($ir, $refusals, new LaravelReleases());
        $refusals->throwIfAny();

        $layout = new PhpLayout($ir, $options->namespace, $kept, $refusals);
        $types = new PhpTypes($layout);
        $operationTypes = new OperationTypes($layout->api, $types, $refusals, new HandlerAccessTypes($layout, $refusals), HandlerAccessPlacement::Request, self::nativePageClasses($ir));
        $formRequests = new FormRequests($layout, $options->rules, $refusals);
        $mount = $entry->mount ?? '';
        $routes = new RouteTable($layout, $options, $refusals, $mount);
        $replies = new LaravelReplies($layout, $operationTypes);
        $contract = new ContractClass($layout, $kept, $entry->frameworkRoutes, $mount, FrameworkRouteScope::of($entry->artefacts));
        $routeHelpers = ArtefactSwitches::routeHelpersOn($entry->artefacts) ? new RouteHelpers($layout, $types, $refusals, $mount) : null;

        $exceptionFiles = (new ContractExceptions($layout->api, $operationTypes, [self::SHOULDNT_REPORT]))->files($kept);
        $replies->exceptions($exceptionFiles, $kept);

        $classFiles = [
            ...(new SchemaTypes($layout, $types, $refusals))->files($kept->enums(), $kept->objects()),
            ...$exceptionFiles,
            ...(new EndpointsTypes($layout))->files($kept),
            $contract->file(),
            ...(new IdentityTypes($layout, $contract, $refusals, self::HOOK_REGISTRATION))->files(),
            ...(new BoundaryClasses($layout, BootCheckSwitches::of($entry->artefacts)))->files(),
        ];

        foreach ($kept->operations() as [$index, $operation]) {
            $names = $layout->operation($operation->id);
            if ($names === null) {
                continue;
            }
            $at = IrPlace::ofOperation($index, $operation->id);
            RestrictedSortKeys::refuse($operation, $at, $refusals);
            $typeFiles = $operationTypes->files($operation, $names, $at);
            $replies->results($typeFiles, $names);
            array_push($classFiles, ...$typeFiles);
            $classFiles[] = $formRequests->file($operation, $at);
            $routes->add($operation, $names, $at);
        }
        $classFiles[] = $routes->tableFile();
        if ($routeHelpers !== null) {
            array_push($classFiles, ...$routeHelpers->files($kept->operations()));
        }

        $refusals->throwIfAny();

        $printer = new PsrPrinter();
        $printer->indentation = str_repeat(' ', $options->indentSpaces);
        $files = array_map(
            static fn (PhpClassFile $file): GeneratedFile => new GeneratedFile($file->path($options->namespace), $printer->printFile($file->file)),
            $classFiles,
        );

        $files[] = $routes->configFile();
        $routesFile = $routes->routesFile();
        if ($routesFile !== null) {
            $files[] = $routesFile;
        }

        usort($files, static fn (GeneratedFile $first, GeneratedFile $second): int => strcmp($first->path, $second->path));

        return $files;
    }

    /**
     * The Laravel paginator a handler answers under each paging style of `@seampact/pack-laravel` the IR holds.
     *
     * @return array<string, string>
     */
    private static function nativePageClasses(ContractIR $ir): array
    {
        $classes = [];
        foreach (self::PACK_PAGINATORS as $styleId => $paginator) {
            if (($ir->pagings[$styleId]->origin->layer ?? null) === self::LARAVEL_PACK_LAYER) {
                $classes[$styleId] = $paginator;
            }
        }

        return $classes;
    }
}
