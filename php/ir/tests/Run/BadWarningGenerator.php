<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\HandlerWarningGenerator;
use Seampact\Ir\Run\TargetEntry;

/** A target for RunnerDiscoveryTest whose `handlerWarnings` returns an item that is not a `ConfigProblem`. */
final class BadWarningGenerator implements Generator, HandlerWarningGenerator
{
    public function irSupport(): IrSupport
    {
        return IrSupport::ofModel([]);
    }

    public function handlerWarnings(ContractIR $ir, TargetEntry $entry): array
    {
        // @phpstan-ignore return.type
        return ['not a problem'];
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        return [];
    }
}
