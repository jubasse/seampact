<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\PsrPrinter;
use Seampact\Codegen\ApiLayout;
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
use Seampact\Codegen\OptionValues;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\RestrictedSortKeys;
use Seampact\Codegen\RouteHelpers;
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
 * interfaces, each operation's input constraint, the contract class, the identity hooks, the route loader, the route
 * names and URL builders, the input resolver, the bundle with its configuration, passes and boundary subscriber, and
 * the api's operation attribute and hook interfaces.
 */
final class SymfonyGenerator implements Generator
{
    public const TARGET = 'symfony';
    public const PACKAGE = 'seampact/symfony';
    private const HTTP_OPERATION = 'httpOperation';
    private const HOOK_REGISTRATION = 'register one service implementing it, with autoconfiguration on';

    public function irSupport(): IrSupport
    {
        return new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, [self::HTTP_OPERATION], []);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $refusals = new Refusals($entry->id, self::TARGET, self::PACKAGE);
        $options = TargetOptions::read(new OptionValues($entry->options, self::TARGET, TargetOptions::KEYS, $refusals), $entry->namespace);
        (new ArtefactSwitches(self::TARGET, null, Delivery::Consumer))->read($entry->artefacts, $refusals);
        $kept = new KeptForms($ir, $refusals, new SymfonyReleases());
        $refusals->throwIfAny();
        if ($options === null) {
            throw new \LogicException('An option without a value was not refused.');
        }

        $layout = new ApiLayout($ir, $options->namespace, $kept, $refusals);
        $placement = new SymfonyPlacement($layout, $kept);
        $refusals->throwIfAny();

        $types = new PhpTypes($layout);
        $operationTypes = new OperationTypes($layout, $types, $refusals, new HandlerAccessTypes($placement, $refusals), HandlerAccessPlacement::Input);
        $constraints = new InputConstraintFiles($ir, $placement, $options->rules, $refusals);
        $mount = $entry->mount ?? '';
        $contract = new ContractClass($placement, $kept, $entry->frameworkRoutes, $mount, FrameworkRouteScope::of($entry->artefacts));
        $classFiles = [
            ...(new SchemaTypes($layout, $types, $refusals, new SchemaConstraints($options->rules)))->files($kept->enums(), $kept->objects()),
            ...(new ContractExceptions($layout, $operationTypes))->files($kept),
            ...(new EndpointsInterfaces($placement))->files(),
            $contract->file(),
            ...(new IdentityTypes($placement, $contract, $refusals, self::HOOK_REGISTRATION))->files(),
            (new RouteLoaderFile($placement, $options, $refusals, $mount))->file(),
            (new InputResolverFile($placement))->file(),
            ...(new BundleFiles($placement, $options, BootCheckSwitches::of($entry->artefacts)))->files(),
            ...(new ApiIdentityFiles($placement))->files(),
        ];
        foreach ($placement->operations() as [$index, $operation]) {
            $at = IrPlace::ofOperation($index, $operation->id);
            RestrictedSortKeys::refuse($operation, $at, $refusals);
            array_push($classFiles, ...$operationTypes->files($operation, $placement->names($operation->id), $at));
            array_push($classFiles, ...$constraints->files($operation, $at));
        }
        if (ArtefactSwitches::routeHelpersOn($entry->artefacts)) {
            array_push($classFiles, ...(new RouteHelpers($placement, $types, $refusals, $mount))->files($placement->operations()));
        }
        $refusals->throwIfAny();

        $printer = new PsrPrinter();
        $printer->indentation = str_repeat(' ', $options->indentSpaces);
        $files = array_map(
            static fn (PhpClassFile $file): GeneratedFile => new GeneratedFile($file->path($options->namespace), $printer->printFile($file->file)),
            $classFiles,
        );
        usort($files, static fn (GeneratedFile $first, GeneratedFile $second): int => strcmp($first->path, $second->path));

        return $files;
    }
}
