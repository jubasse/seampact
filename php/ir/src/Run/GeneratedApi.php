<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Write\GeneratedFile;

/** One api's files, their paths below the entry root, and the forms its target leaves to the handler. */
final readonly class GeneratedApi
{
    /**
     * @param list<GeneratedFile> $files
     * @param list<ConfigProblem> $warnings
     */
    public function __construct(public array $files, public array $warnings)
    {
    }
}
