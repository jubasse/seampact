<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Seampact\Ir\Write\GeneratedFile;

/**
 * The runtime the generated rules and requests use, copied into `<namespace>\Laravel\Runtime` (ADR 0015 "Runtime
 * helpers"), so generated code imports no seampact package other than `seampact/hooks`.
 */
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
        $sources = glob(self::SOURCE_DIRECTORY . '/*.php');
        if ($sources === false || $sources === []) {
            throw new \RuntimeException('The seampact/laravel runtime sources are missing from ' . self::SOURCE_DIRECTORY . '; reinstall seampact/laravel.');
        }
        sort($sources);

        $prefix = substr($layout->runtimeNamespace, strlen($layout->namespace) + 1);
        $files = [];
        foreach ($sources as $source) {
            $text = file_get_contents($source);
            if ($text === false) {
                throw new \RuntimeException("The runtime source {$source} could not be read; check its permissions or reinstall seampact/laravel.");
            }
            $copied = str_replace('namespace ' . self::SOURCE_NAMESPACE . ';', "namespace {$layout->runtimeNamespace};", $text);
            $files[] = new GeneratedFile(str_replace('\\', '/', $prefix) . '/' . basename($source), $copied);
        }

        return $files;
    }
}
