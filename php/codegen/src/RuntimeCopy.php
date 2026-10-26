<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Write\GeneratedFile;

/**
 * A target's runtime sources copied into the generated namespace (ADR 0015 "Runtime helpers"), so generated code
 * imports no seampact package other than `seampact/hooks`: each file of each source directory with its namespace line
 * rewritten. The shared runtime of `seampact/codegen` lands in the same namespace as the target's own, so a target
 * source's `use Seampact\Codegen\Runtime\<Name>;` line is dropped.
 */
final readonly class RuntimeCopy
{
    public const SHARED_NAMESPACE = 'Seampact\\Codegen\\Runtime';
    private const SHARED_DIRECTORY = __DIR__ . '/../runtime';
    private const SHARED_PACKAGE = 'seampact/codegen';
    private const SHARED_USE_LINE = '/^use Seampact\\\\Codegen\\\\Runtime\\\\[A-Za-z0-9_]+;\n/m';
    // Any seampact namespace, in source or string spelling, but the hooks package that generated code may import.
    private const LEFTOVER_REFERENCE = '/Seampact(?:\\\\){1,2}+(?!Hooks\\\\)/';

    /** @param list<RuntimeSource> $sources */
    public function __construct(private array $sources)
    {
    }

    /** The framework-neutral boundary runtime that `seampact/codegen` ships for every PHP target. */
    public static function sharedSource(): RuntimeSource
    {
        return new RuntimeSource(self::SHARED_NAMESPACE, self::SHARED_DIRECTORY, self::SHARED_PACKAGE);
    }

    /** @return list<GeneratedFile> each source under `$runtimeNamespace`, its path relative to `$rootNamespace`'s directory */
    public function files(string $rootNamespace, string $runtimeNamespace): array
    {
        $prefix = str_replace('\\', '/', substr($runtimeNamespace, strlen($rootNamespace) + 1));
        $files = [];
        $copiedFrom = [];
        foreach ($this->sources as $source) {
            foreach (self::sourceFiles($source) as $path) {
                $name = basename($path);
                if (isset($copiedFrom[$name])) {
                    throw new \RuntimeException("The runtime source {$name} exists in both {$copiedFrom[$name]} and {$source->package}; rename one of them.");
                }
                $copiedFrom[$name] = $source->package;
                $files[] = new GeneratedFile("{$prefix}/{$name}", self::copied($source, $path, $runtimeNamespace));
            }
        }

        return $files;
    }

    /** @return list<string> */
    private static function sourceFiles(RuntimeSource $source): array
    {
        $paths = glob($source->directory . '/*.php');
        if ($paths === false || $paths === []) {
            throw new \RuntimeException("The {$source->package} runtime sources are missing from {$source->directory}; reinstall {$source->package}.");
        }
        sort($paths);

        return $paths;
    }

    private static function copied(RuntimeSource $source, string $path, string $runtimeNamespace): string
    {
        $text = file_get_contents($path);
        if ($text === false) {
            throw new \RuntimeException("The runtime source {$path} could not be read; check its permissions or reinstall {$source->package}.");
        }

        $copied = str_replace("namespace {$source->namespace};", "namespace {$runtimeNamespace};", $text, $replaced);
        if ($replaced !== 1) {
            throw new \RuntimeException("The runtime source {$path} declares 'namespace {$source->namespace};' {$replaced} times instead of once; reinstall {$source->package}.");
        }

        $copied = (string) preg_replace(self::SHARED_USE_LINE, '', $copied, -1, $dropped);
        if ($dropped > 0) {
            // A use block of shared names only leaves its trailing blank line behind.
            $copied = str_replace("namespace {$runtimeNamespace};\n\n\n", "namespace {$runtimeNamespace};\n\n", $copied);
        }

        self::refuseLeftoverReference($source, $path, $copied, $runtimeNamespace);

        return $copied;
    }

    // The app's own runtime namespace may itself start with `Seampact\`, so it is set aside before the search.
    private static function refuseLeftoverReference(RuntimeSource $source, string $path, string $copied, string $runtimeNamespace): void
    {
        $ownNamespace = [$runtimeNamespace, str_replace('\\', '\\\\', $runtimeNamespace)];
        foreach (explode("\n", $copied) as $index => $line) {
            if (preg_match(self::LEFTOVER_REFERENCE, str_replace($ownNamespace, '', $line)) === 1) {
                $number = $index + 1;
                throw new \RuntimeException("The runtime source {$path} line {$number} names a seampact namespace other than Seampact\\Hooks, which generated code cannot import; reinstall {$source->package}.");
            }
        }
    }
}
