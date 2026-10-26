<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Nette\PhpGenerator\PsrPrinter;
use Seampact\Codegen\ContractExceptions;
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
 * value types, the controller interfaces, the results and exceptions, the FormRequests with their rules, the route
 * table (and `routes.php` under `routes: file`) and the copied runtime.
 */
final class LaravelGenerator implements Generator
{
    public const TARGET = 'laravel';
    public const PACKAGE = 'seampact/laravel';
    private const HTTP_OPERATION = 'httpOperation';
    // Laravel's exception handler does not report a declared error a handler throws.
    private const SHOULDNT_REPORT = 'Illuminate\\Contracts\\Debug\\ShouldntReport';
    private const BOOT_CHECK = 'bootCheck';
    private const ACCESS_HOOKS = 'accessHooks';

    public function irSupport(): IrSupport
    {
        return new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, [self::HTTP_OPERATION], []);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $options = LaravelOptions::parse($entry->options, $entry->namespace, $entry->id);
        $refusals = new Refusals($entry->id, self::TARGET, self::PACKAGE);

        self::readArtefacts($entry->artefacts, $refusals);

        $kept = new KeptForms($ir, $refusals, new LaravelReleases());
        $refusals->throwIfAny();

        $layout = new PhpLayout($ir, $options->namespace, $kept, $refusals);
        $types = new PhpTypes($layout);
        $operationTypes = new OperationTypes($layout->api, $types, $refusals);
        $formRequests = new FormRequests($layout, $options->rules, $refusals);
        $routes = new RouteTable($layout, $options, $refusals);

        $classFiles = [
            ...(new SchemaTypes($layout, $types, $refusals))->files($kept->enums(), $kept->objects()),
            ...(new ContractExceptions($layout->api, $operationTypes, [self::SHOULDNT_REPORT]))->files($kept),
            ...(new EndpointsTypes($layout))->files($kept),
        ];

        foreach ($kept->operations() as [$index, $operation]) {
            $names = $layout->operation($operation->id);
            if ($names === null) {
                continue;
            }
            $at = IrPlace::ofOperation($index, $operation->id);
            array_push($classFiles, ...$operationTypes->files($operation, $names, $at));
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

    // The boot check and hooks access come with laravel-2, native access (`accessHooks: false`) with laravel-4; the
    // target declares no other artefact.
    private static function readArtefacts(\stdClass $artefacts, Refusals $refusals): void
    {
        foreach (get_object_vars($artefacts) as $artefact => $value) {
            $artefact = (string) $artefact;
            $at = IrPlace::root()->below('artefacts', $artefact);
            $release = match ($artefact) {
                self::BOOT_CHECK => LaravelReleases::LARAVEL_2,
                self::ACCESS_HOOKS => $value === false ? LaravelReleases::LARAVEL_4 : LaravelReleases::LARAVEL_2,
                default => null,
            };

            if ($release !== null) {
                $refusals->waitingForRelease("artefacts.{$artefact}", "The artefact switch '{$artefact}: " . json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "'", $at, $release);
                continue;
            }

            $refusals->add(
                'artefacts.unknown',
                "The artefact '{$artefact}' is not one the laravel target declares; it takes '" . self::BOOT_CHECK . "' and '" . self::ACCESS_HOOKS . "'.",
                "Remove '{$artefact}' from the entry's `artefacts`.",
                $at,
            );
        }
    }
}
