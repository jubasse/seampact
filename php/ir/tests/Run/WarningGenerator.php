<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\HandlerWarningGenerator;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Ir\Write\GeneratedFile;

/** A target for RunnerDiscoveryTest that leaves one form to the handler. */
final class WarningGenerator implements Generator, HandlerWarningGenerator
{
    public function irSupport(): IrSupport
    {
        return IrSupport::ofModel([]);
    }

    public function handlerWarnings(ContractIR $ir, TargetEntry $entry): array
    {
        return [new ConfigProblem('identity.headers.handler', 'Left to the handler.', 'Check it in the handler.', 'here')];
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        return [new GeneratedFile('Api.php', "<?php\n\ndeclare(strict_types=1);\n\nnamespace {$entry->namespace};\n\nfinal class Api\n{\n}\n")];
    }
}
