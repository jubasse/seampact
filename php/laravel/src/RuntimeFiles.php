<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Codegen\RuntimeCopy;
use Seampact\Codegen\RuntimeSource;
use Seampact\Ir\Write\GeneratedFile;

/** The runtime the generated rules and requests use, copied into `<namespace>\Laravel\Runtime`. */
final class RuntimeFiles
{
    private const SOURCE_NAMESPACE = 'Seampact\\Laravel\\Runtime';
    private const SOURCE_DIRECTORY = __DIR__ . '/../runtime';

    private function __construct()
    {
    }

    /** @return list<GeneratedFile> */
    public static function copied(PhpLayout $layout): array
    {
        return (new RuntimeCopy([new RuntimeSource(self::SOURCE_NAMESPACE, self::SOURCE_DIRECTORY, LaravelGenerator::PACKAGE)]))->files($layout->namespace, $layout->runtimeNamespace);
    }
}
