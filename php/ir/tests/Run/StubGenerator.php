<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Run;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Run\Generator;
use Seampact\Ir\Run\TargetEntry;
use Seampact\Ir\Write\GeneratedFile;

/** A target for RunnerDiscoveryTest: one class naming the api and its operation count, in the entry's namespace. */
final class StubGenerator implements Generator
{
    public function irSupport(): IrSupport
    {
        return IrSupport::ofModel([]);
    }

    public function generate(ContractIR $ir, TargetEntry $entry): array
    {
        $operations = count($ir->operations);

        return [
            new GeneratedFile('Api.php', "<?php\n\ndeclare(strict_types=1);\n\nnamespace {$entry->namespace};\n\nfinal class Api\n{\n    public const NAME = '{$entry->api}';\n    public const OPERATIONS = {$operations};\n}\n"),
            new GeneratedFile('options.json', (string) json_encode($entry->options) . "\n"),
        ];
    }
}
