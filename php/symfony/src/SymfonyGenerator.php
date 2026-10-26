<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\PsrPrinter;
use Seampact\Codegen\ApiLayout;
use Seampact\Codegen\ContractExceptions;
use Seampact\Codegen\IrPlace;
use Seampact\Codegen\KeptForms;
use Seampact\Codegen\OperationTypes;
use Seampact\Codegen\OptionValues;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RuntimeCopy;
use Seampact\Codegen\SchemaTypes;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Ir\Write\GeneratedFile;

/**
 * The symfony target (ADR 0024), which `vendor/bin/seampact` finds through `extra.seampact.generator`: per api, the
 * shared value types, inputs, results and exceptions of `seampact/codegen`, then the Symfony placement: the endpoints
 * interfaces, each operation's input constraint, the route loader, the input resolver, the bundle with its
 * configuration and controller pass, and the copied runtime.
 */
final class SymfonyGenerator implements Generator
{
    public const TARGET = 'symfony';
    public const PACKAGE = 'seampact/symfony';
    private const HTTP_OPERATION = 'httpOperation';
    private const BOOT_CHECK = 'bootCheck';
    private const ACCESS_HOOKS = 'accessHooks';
    private const RUNTIME_SOURCE_NAMESPACE = 'Seampact\\Symfony\\Runtime';
    private const RUNTIME_SOURCE_DIRECTORY = __DIR__ . '/../runtime';

    public function irSupport(): IrSupport
    {
        return new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, [self::HTTP_OPERATION], []);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $refusals = new Refusals($entry->id, self::TARGET, self::PACKAGE);
        $options = TargetOptions::read(new OptionValues($entry->options, self::TARGET, TargetOptions::KEYS, $refusals), $entry->namespace);
        self::readArtefacts($entry->artefacts, $refusals);
        $kept = new KeptForms($ir, $refusals, new SymfonyReleases());
        $refusals->throwIfAny();
        if ($options === null) {
            throw new \LogicException('An option without a value was not refused.');
        }

        $layout = new ApiLayout($ir, $options->namespace, $kept, $refusals);
        $placement = new SymfonyPlacement($layout, $kept);
        $refusals->throwIfAny();

        $types = new PhpTypes($layout);
        $operationTypes = new OperationTypes($layout, $types, $refusals);
        $constraints = new InputConstraintFiles($ir, $placement, $options->rules, $refusals);
        $classFiles = [
            ...(new SchemaTypes($layout, $types, $refusals))->files($kept->enums(), $kept->objects()),
            ...(new ContractExceptions($layout, $operationTypes))->files($kept),
            ...(new EndpointsInterfaces($placement))->files(),
            (new RouteLoaderFile($placement, $refusals))->file(),
            (new InputResolverFile($placement))->file(),
            ...(new BundleFiles($placement, $options))->files(),
        ];
        foreach ($placement->operations() as [$index, $operation]) {
            $at = IrPlace::ofOperation($index, $operation->id);
            array_push($classFiles, ...$operationTypes->files($operation, $placement->names($operation->id), $at));
            array_push($classFiles, ...$constraints->files($operation, $at));
        }
        $refusals->throwIfAny();

        $printer = new PsrPrinter();
        $printer->indentation = str_repeat(' ', $options->indentSpaces);
        $files = [
            ...array_map(
                static fn (PhpClassFile $file): GeneratedFile => new GeneratedFile($file->path($options->namespace), $printer->printFile($file->file)),
                $classFiles,
            ),
            ...(new RuntimeCopy(self::RUNTIME_SOURCE_NAMESPACE, self::RUNTIME_SOURCE_DIRECTORY, self::PACKAGE))->files($placement->namespace, $placement->runtimeNamespace),
        ];
        usort($files, static fn (GeneratedFile $first, GeneratedFile $second): int => strcmp($first->path, $second->path));

        return $files;
    }

    // The boot check and hooks access come with symfony-2, native access (`accessHooks: false`) with symfony-4; the
    // target declares no other artefact.
    private static function readArtefacts(\stdClass $artefacts, Refusals $refusals): void
    {
        foreach (get_object_vars($artefacts) as $artefact => $value) {
            $artefact = (string) $artefact;
            $at = IrPlace::root()->below('artefacts', $artefact);
            $release = match ($artefact) {
                self::BOOT_CHECK => SymfonyReleases::SYMFONY_2,
                self::ACCESS_HOOKS => $value === false ? SymfonyReleases::SYMFONY_4 : SymfonyReleases::SYMFONY_2,
                default => null,
            };
            if ($release !== null) {
                $refusals->waitingForRelease("artefacts.{$artefact}", "The artefact switch '{$artefact}: " . json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES) . "'", $at, $release);
                continue;
            }
            $refusals->add(
                'artefacts.unknown',
                "The artefact '{$artefact}' is not one the symfony target declares; it takes '" . self::BOOT_CHECK . "' and '" . self::ACCESS_HOOKS . "'.",
                "Remove '{$artefact}' from the entry's `artefacts`.",
                $at,
            );
        }
    }
}
