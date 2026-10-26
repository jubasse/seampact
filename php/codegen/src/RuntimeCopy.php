<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Write\GeneratedFile;

/**
 * A target's runtime sources copied into the generated namespace (ADR 0015 "Runtime helpers"), so generated code
 * imports no seampact package other than `seampact/hooks`: each file of the source directory with its namespace line
 * rewritten.
 */
final readonly class RuntimeCopy
{
    /**
     * @param string $sourceNamespace the namespace every runtime source declares
     * @param string $package the Composer package that ships the sources, named in the fix
     */
    public function __construct(private string $sourceNamespace, private string $sourceDirectory, private string $package)
    {
    }

    /** @return list<GeneratedFile> each source under `$runtimeNamespace`, its path relative to `$rootNamespace`'s directory */
    public function files(string $rootNamespace, string $runtimeNamespace): array
    {
        $sources = glob($this->sourceDirectory . '/*.php');
        if ($sources === false || $sources === []) {
            throw new \RuntimeException("The {$this->package} runtime sources are missing from {$this->sourceDirectory}; reinstall {$this->package}.");
        }
        sort($sources);

        $prefix = str_replace('\\', '/', substr($runtimeNamespace, strlen($rootNamespace) + 1));
        $files = [];
        foreach ($sources as $source) {
            $text = file_get_contents($source);
            if ($text === false) {
                throw new \RuntimeException("The runtime source {$source} could not be read; check its permissions or reinstall {$this->package}.");
            }
            $copied = str_replace("namespace {$this->sourceNamespace};", "namespace {$runtimeNamespace};", $text, $replaced);
            if ($replaced !== 1) {
                throw new \RuntimeException("The runtime source {$source} declares 'namespace {$this->sourceNamespace};' {$replaced} times instead of once; reinstall {$this->package}.");
            }
            $files[] = new GeneratedFile("{$prefix}/" . basename($source), $copied);
        }

        return $files;
    }
}
