<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Ir\Write\GeneratedFile;

/**
 * The runtime the generated constraints, attribute and resolver use, copied into `<namespace>\Symfony\Runtime`
 * (ADR 0015 "Runtime helpers"), so generated code imports no seampact package other than `seampact/hooks`.
 */
final class RuntimeFiles
{
    private const SOURCE_NAMESPACE = 'Seampact\\Symfony\\Runtime';
    private const SOURCE_DIRECTORY = __DIR__ . '/../runtime';

    private function __construct()
    {
    }

    /** @return list<GeneratedFile> */
    public static function copied(SymfonyPlacement $placement): array
    {
        $sources = glob(self::SOURCE_DIRECTORY . '/*.php');
        if ($sources === false || $sources === []) {
            throw new \RuntimeException('The seampact/symfony runtime sources are missing from ' . self::SOURCE_DIRECTORY . '; reinstall seampact/symfony.');
        }
        sort($sources);

        $prefix = str_replace('\\', '/', substr($placement->runtimeNamespace, strlen($placement->namespace) + 1));
        $files = [];
        foreach ($sources as $source) {
            $text = file_get_contents($source);
            if ($text === false) {
                throw new \RuntimeException("The runtime source {$source} could not be read; check its permissions or reinstall seampact/symfony.");
            }
            $copied = str_replace('namespace ' . self::SOURCE_NAMESPACE . ';', "namespace {$placement->runtimeNamespace};", $text);
            $files[] = new GeneratedFile("{$prefix}/" . basename($source), $copied);
        }

        return $files;
    }
}
