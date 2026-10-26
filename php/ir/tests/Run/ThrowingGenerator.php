<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;

/** A target for RunnerDiscoveryTest whose generator fails with an exception of its own. */
final class ThrowingGenerator implements Generator
{
    public const MESSAGE = 'the template for operation getTask is missing';

    public function irSupport(): IrSupport
    {
        return IrSupport::ofModel([]);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        throw new \RuntimeException(self::MESSAGE);
    }
}
