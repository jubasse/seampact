<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Nette\PhpGenerator\PsrPrinter;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Ir\Write\GeneratedFile;
use Seampact\Symfony\Shared\PendingSharedTypes;
use Seampact\Symfony\Shared\SharedTypesSource;

/**
 * The symfony target (ADR 0024), which `vendor/bin/seampact` finds through `extra.seampact.generator`: per api, the
 * shared value types, inputs, results and exceptions, then the Symfony placement: the endpoints interfaces, each
 * operation's input constraint, the route loader, the input resolver, the bundle with its configuration and
 * controller pass, and the copied runtime.
 */
final class SymfonyGenerator implements Generator
{
    private const HTTP_OPERATION = 'httpOperation';

    private readonly SharedTypesSource $sharedTypes;

    public function __construct(?SharedTypesSource $sharedTypes = null)
    {
        $this->sharedTypes = $sharedTypes ?? new PendingSharedTypes();
    }

    public function irSupport(): IrSupport
    {
        return new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, [self::HTTP_OPERATION], []);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $options = SymfonyOptions::parse($entry->options, $entry->namespace, $entry->id);
        $problems = new GenerationProblems($entry->id);

        foreach (array_keys(get_object_vars($entry->artefacts)) as $artefact) {
            $problems->add(
                'artefacts.' . $artefact . '.unsupported',
                "The artefact switch '{$artefact}' is not read by the symfony target yet: a later seampact/symfony release brings it.",
                "Remove '{$artefact}' from the entry's `artefacts`.",
                '/artefacts/' . str_replace(['~', '/'], ['~0', '~1'], (string) $artefact),
            );
        }
        $problems->throwIfAny();

        $shared = $this->sharedTypes->types($ir, $options->namespace, $entry->id);
        $placement = new SymfonyPlacement($options->namespace, $shared->apiTypeName(), SymfonyPlacement::apiKeyOf(...$ir->api->name->segments));

        $constraints = new InputConstraintFiles($ir, $shared, $placement, $options->rules, $problems);
        $classFiles = [
            ...(new EndpointsInterfaces($shared))->files(),
            (new RouteLoaderFile($shared, $placement, $problems))->file(),
            (new InputResolverFile($shared, $placement))->file(),
            ...(new BundleFiles($shared, $placement, $options))->files(),
        ];
        foreach ($shared->operations() as [$index, $operation]) {
            array_push($classFiles, ...$constraints->files($operation, $index));
        }

        $problems->throwIfAny();

        $printer = new PsrPrinter();
        $printer->indentation = str_repeat(' ', $options->indentSpaces);
        $files = [
            ...$shared->files(),
            ...array_map(
                static fn (ClassFile $file): GeneratedFile => new GeneratedFile($file->path($options->namespace), $printer->printFile($file->file)),
                $classFiles,
            ),
            ...RuntimeFiles::copied($placement),
        ];
        usort($files, static fn (GeneratedFile $first, GeneratedFile $second): int => strcmp($first->path, $second->path));

        return $files;
    }
}
