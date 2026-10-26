<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\PsrPrinter;
use Seampact\Codegen\ContractExceptions;
use Seampact\Codegen\ArtefactSwitches;
use Seampact\Codegen\BootCheckSwitches;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationTypes;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Refusals;
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
 * with their rules, the route table (and `routes.php` under `routes: file`), the contract class, the identity hooks,
 * the middleware and service provider, and the copied runtime.
 */
final class LaravelGenerator implements Generator
{
    public const TARGET = 'laravel';
    public const PACKAGE = 'seampact/laravel';
    private const HTTP_OPERATION = 'httpOperation';
    // Laravel's exception handler does not report a declared error a handler throws.
    private const SHOULDNT_REPORT = 'Illuminate\\Contracts\\Debug\\ShouldntReport';

    public function irSupport(): IrSupport
    {
        return new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, [self::HTTP_OPERATION], []);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $options = LaravelOptions::parse($entry->options, $entry->namespace, $entry->id);
        $refusals = new Refusals($entry->id, self::TARGET, self::PACKAGE);

        (new ArtefactSwitches(self::TARGET, null, LaravelReleases::LARAVEL_4))->read($entry->artefacts, $refusals);

        $kept = new KeptForms($ir, $refusals, new LaravelReleases());
        $refusals->throwIfAny();

        $layout = new PhpLayout($ir, $options->namespace, $kept, $refusals);
        $types = new PhpTypes($layout);
        $operationTypes = new OperationTypes($layout->api, $types, $refusals);
        $formRequests = new FormRequests($layout, $options->rules, $refusals);
        $routes = new RouteTable($layout, $options, $refusals);
        $replies = new LaravelReplies($layout, $operationTypes);
        $contract = new ContractClass($layout, $kept, $entry->frameworkRoutes);

        $exceptionFiles = (new ContractExceptions($layout->api, $operationTypes, [self::SHOULDNT_REPORT]))->files($kept);
        $replies->exceptions($exceptionFiles, $kept);

        $classFiles = [
            ...(new SchemaTypes($layout, $types, $refusals))->files($kept->enums(), $kept->objects()),
            ...$exceptionFiles,
            ...(new EndpointsTypes($layout))->files($kept),
            $contract->file(),
            ...(new IdentityTypes($layout, $contract, $refusals))->files(),
            ...(new BoundaryClasses($layout, BootCheckSwitches::of($entry->artefacts)))->files(),
        ];

        foreach ($kept->operations() as [$index, $operation]) {
            $names = $layout->operation($operation->id);
            if ($names === null) {
                continue;
            }
            $at = IrPlace::ofOperation($index, $operation->id);
            $typeFiles = $operationTypes->files($operation, $names, $at);
            $replies->results($typeFiles, $names);
            array_push($classFiles, ...$typeFiles);
            $classFiles[] = $formRequests->file($operation, $at);
            $routes->add($operation, $names, $at);
        }
        $classFiles[] = $routes->tableFile();

        $refusals->throwIfAny();

        $printer = new PsrPrinter();
        $printer->indentation = str_repeat(' ', $options->indentSpaces);
        $files = array_map(
            static fn (PhpClassFile $file): GeneratedFile => new GeneratedFile($file->path($options->namespace), $printer->printFile($file->file)),
            $classFiles,
        );

        $routesFile = $routes->routesFile();
        if ($routesFile !== null) {
            $files[] = $routesFile;
        }

        $files = [...$files, ...RuntimeFiles::copied($layout)];
        usort($files, static fn (GeneratedFile $first, GeneratedFile $second): int => strcmp($first->path, $second->path));

        return $files;
    }
}
