<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\BootCheckSwitches;
use Seampact\Codegen\PhpClassFile;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\TargetOptions;
use Seampact\Ir\Model\ContractIR;

/** The Symfony target itself: no file or service beyond the placement's, and the runtime boundary subscriber. */
final class PlainSymfony implements SymfonyFlavour
{
    public const TARGET = 'symfony';
    public const PACKAGE = 'seampact/symfony';

    public function target(): string
    {
        return self::TARGET;
    }

    public function package(): string
    {
        return self::PACKAGE;
    }

    public function boundaryParent(SymfonyPlacement $placement): string
    {
        return $placement->runtime('BoundarySubscriber');
    }

    public function frameworkRouteControllers(): array
    {
        return [];
    }

    public function files(ContractIR $ir, SymfonyPlacement $placement, TargetOptions $options, Refusals $refusals, array $routePaths): array
    {
        return [];
    }

    public function bundleStatements(PhpClassFile $file, SymfonyPlacement $placement, ?BootCheckSwitches $bootCheck): string
    {
        return '';
    }
}
