<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Write\GeneratedFile;

/**
 * A committed golden tree of generated files, as a target's golden test compares it: every file by its POSIX path
 * relative to the tree's directory, and a rewrite that replaces the tree with what the generator wrote.
 */
final readonly class GoldenTree
{
    public function __construct(public string $directory)
    {
    }

    /**
     * The generated files of several runs, each run under its own subdirectory, sorted by path.
     *
     * @param array<string, list<GeneratedFile>> $runs each subdirectory and the files generated into it
     * @return array<string, string>
     */
    public static function flattened(array $runs): array
    {
        $tree = [];
        foreach ($runs as $subdirectory => $files) {
            foreach ($files as $file) {
                $tree["{$subdirectory}/{$file->path}"] = $file->contents;
            }
        }
        ksort($tree);

        return $tree;
    }

    /** @return array<string, string> each committed file by its relative path, sorted */
    public function committed(): array
    {
        $tree = [];
        if (!is_dir($this->directory)) {
            return $tree;
        }

        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($this->directory, \FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
            if (!$file instanceof \SplFileInfo || !$file->isFile()) {
                continue;
            }
            $relative = substr($file->getPathname(), strlen($this->directory) + 1);
            $contents = file_get_contents($file->getPathname());
            if ($contents === false) {
                throw new \RuntimeException("The golden file {$file->getPathname()} could not be read.");
            }
            $tree[str_replace(DIRECTORY_SEPARATOR, '/', $relative)] = $contents;
        }
        ksort($tree);

        return $tree;
    }

    /** @param array<string, string> $generated */
    public function rewrite(array $generated): void
    {
        foreach (array_keys($this->committed()) as $path) {
            unlink("{$this->directory}/{$path}");
        }

        foreach ($generated as $path => $contents) {
            $target = "{$this->directory}/{$path}";
            if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0o755, true)) {
                throw new \RuntimeException('The golden directory ' . dirname($target) . ' could not be created.');
            }
            if (file_put_contents($target, $contents) === false) {
                throw new \RuntimeException("The golden file {$target} could not be written.");
            }
        }
    }
}
