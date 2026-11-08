<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Model\ContractIR;

/**
 * What a target that runs on the Symfony placement changes in it: its name in refusals and file headers, the class its
 * boundary subscriber extends, the files it adds beside the placement's, and the services its bundle registers. The
 * Symfony target is the plain flavour; `seampact/api-platform` is another.
 */
interface SymfonyFlavour
{
    /** The target id, as the entry's refusals name it. */
    public function target(): string;

    /** The Composer package of the target. */
    public function package(): string;

    /** The runtime class the generated boundary subscriber extends. */
    public function boundaryParent(SymfonyPlacement $placement): string;

    /**
     * @param array<string, string> $routePaths each routable operation's Symfony path, by operation id
     * @return list<PhpClassFile> the files the flavour adds to the api's tree
     */
    public function files(ContractIR $ir, SymfonyPlacement $placement, TargetOptions $options, Refusals $refusals, array $routePaths): array;

    /** The statements the bundle's `loadExtension` runs after its own services, naming each class through `$file`. */
    public function bundleStatements(PhpClassFile $file, SymfonyPlacement $placement): string;
}
