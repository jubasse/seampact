<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;

/** A target for RunnerDiscoveryTest built before `HandlerWarningGenerator`: it has no `handlerWarnings`. */
final class OldGenerator implements Generator
{
    public function irSupport(): IrSupport
    {
        return IrSupport::ofModel([]);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        return [];
    }
}
