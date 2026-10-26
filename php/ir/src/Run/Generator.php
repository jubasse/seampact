<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Write\GeneratedFile;

/**
 * A PHP target (ADR 0010): a class a Composer package names in its `extra.seampact.generator`, built with no
 * argument. `vendor/bin/seampact` reads each api an entry names with the target's `irSupport()`, then writes the
 * files `generate()` returns through the generated-file writer, with the header added. Generating is pure: the same
 * IR and entry give the same files, and a target never writes a file itself.
 */
interface Generator
{
    /** The IR versions, revision, declaration kinds and must-understand features this target reads. */
    public function irSupport(): IrSupport;

    /**
     * The files of one api of `$entry`, each path relative to `$entry->outputDirectory`.
     *
     * @return list<GeneratedFile>
     * @throws GenerationRefusedException a contract or option the target refuses, by name
     */
    public function generate(ContractIR $ir, TargetEntry $entry): array;
}
