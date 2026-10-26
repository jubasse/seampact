<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/**
 * Writes a target's files into its output directory (ADR 0015 "Writing files"), as the Node writer
 * (`codegen-core/src/writer.ts`) and the JVM writer do, with their codes: UTF-8 without a byte-order mark, LF line
 * endings and a final newline, only inside the output directory, with `.seampact-manifest.json` listing each file
 * and its SHA-256. Files a previous run generated and this one does not are removed. Every check runs before the
 * first write: a manifest that is not a regular file or belongs to another target, a file the writer did not
 * generate, a hand-edited one (unless `HandEditPolicy::Overwrite`, the `--force` semantics) or a path leaving the
 * directory through a link refuses the whole write, naming the file and the fix.
 */
final class GeneratedWriter
{
    private const BYTE_ORDER_MARK = "\u{FEFF}";

    private const DIRECTORY_MODE = 0777;

    private const HAND_EDIT_FIX = 'Move the hand-written code next to the generated files, then delete the edited file and run '
        . '`vendor/bin/seampact generate` again, or run `vendor/bin/seampact generate --force` to write over it.';

    private function __construct()
    {
    }

    /**
     * Every check of a write of `$files` into `$outDir` for the target entry `$owner`, with nothing written, so a
     * caller writing several directories checks them all first.
     *
     * @param list<GeneratedFile> $files
     * @return PlannedWrite|list<WriterRefusal>
     */
    public static function plan(string $outDir, string $owner, array $files, HandEditPolicy $onHandEdit): PlannedWrite|array
    {
        $checked = GeneratedPaths::checked($files);
        if ($checked !== [] && $checked[0] instanceof WriterRefusal) {
            return array_values(array_filter($checked, static fn (object $item): bool => $item instanceof WriterRefusal));
        }

        $rootDir = self::realPathOfMissing($outDir);
        $manifestPath = $rootDir . '/' . WriterManifest::FILE_NAME;
        if (self::exists($manifestPath) && (is_link($manifestPath) || !is_file($manifestPath))) {
            return [new WriterRefusal(
                'writer.manifest.not-regular',
                "The manifest {$manifestPath} is not a regular file, so the writer does not read or write it.",
                "Delete {$manifestPath}, then generate again.",
            )];
        }

        $manifest = WriterManifest::read($rootDir);
        if (is_string($manifest)) {
            return [new WriterRefusal(
                'writer.manifest.invalid',
                "The manifest {$manifestPath} cannot be read: {$manifest}.",
                'Delete the generated files of this target and its manifest, then generate again.',
            )];
        }

        if ($manifest->owner !== null && $manifest->owner !== $owner) {
            return [new WriterRefusal(
                'writer.manifest.other-owner',
                "The output directory {$rootDir} belongs to the target '{$manifest->owner}', not '{$owner}'.",
                "Give '{$owner}' its own `out` directory, or delete {$manifestPath} and the files of '{$manifest->owner}'.",
            )];
        }

        $bytesByPath = [];
        foreach ($checked as $file) {
            if ($file instanceof GeneratedFile) {
                $bytesByPath[$file->path] = self::normalizedBytes($file->contents);
            }
        }

        return self::planFiles($rootDir, $owner, $bytesByPath, $manifest->hashByPath, $onHandEdit);
    }

    /** Writes a planned write: the changed files, the removal of the stale ones, then the manifest. */
    public static function commit(PlannedWrite $write): WrittenFiles
    {
        self::createDirectory($write->rootDir);
        $written = $write->changed();

        foreach ($written as $path) {
            $target = $write->rootDir . '/' . $path;
            self::createDirectory(dirname($target));
            self::writeFile($target, $write->bytesByPath[$path]);
        }

        foreach ($write->removable as $path) {
            $target = $write->rootDir . '/' . $path;
            if (!unlink($target)) {
                throw new \RuntimeException("seampact: removing the stale generated file '{$target}' failed; check its permissions, then generate again.");
            }
            self::removeEmptyDirectories($write->rootDir, dirname($target));
        }

        $hashByPath = array_map(static fn (string $bytes): string => hash('sha256', $bytes), $write->bytesByPath);
        self::writeFile($write->rootDir . '/' . WriterManifest::FILE_NAME, WriterManifest::serialized($write->owner, $hashByPath));

        return new WrittenFiles($written, $write->unchanged, $write->removable);
    }

    /**
     * @param array<string, string> $bytesByPath
     * @param array<string, string> $recorded
     * @return PlannedWrite|list<WriterRefusal>
     */
    private static function planFiles(string $rootDir, string $owner, array $bytesByPath, array $recorded, HandEditPolicy $onHandEdit): PlannedWrite|array
    {
        $refusals = [];
        $unchanged = [];
        $removable = [];

        foreach ($bytesByPath as $path => $bytes) {
            $path = (string) $path;
            $state = self::existingFileState($rootDir, $path, $recorded[$path] ?? null, $onHandEdit);
            if ($state instanceof WriterRefusal) {
                $refusals[] = $state;
            } elseif ($state === hash('sha256', $bytes)) {
                $unchanged[] = $path;
            }
        }

        foreach ($recorded as $path => $sha256) {
            $path = (string) $path;
            if (array_key_exists($path, $bytesByPath)) {
                continue;
            }

            $state = self::existingFileState($rootDir, $path, $sha256, $onHandEdit);
            if ($state instanceof WriterRefusal) {
                $refusals[] = $state;
            } elseif ($state !== null) {
                $removable[] = $path;
            }
        }

        if ($refusals !== []) {
            return $refusals;
        }

        return new PlannedWrite($rootDir, $owner, $bytesByPath, $unchanged, $removable);
    }

    // What is at `$path` now: nothing (null), the SHA-256 of the file the manifest recorded, or a refusal.
    private static function existingFileState(string $rootDir, string $path, ?string $recordedSha256, HandEditPolicy $onHandEdit): string|WriterRefusal|null
    {
        $file = $rootDir . '/' . $path;

        if (self::leavesRoot($rootDir, $file)) {
            return new WriterRefusal(
                'writer.path.outside',
                "'{$file}' resolves outside the output directory {$rootDir} through a symbolic link.",
                'Replace the symbolic link in the output directory with a plain directory.',
            );
        }

        if (!self::exists($file)) {
            return null;
        }

        if (is_link($file) || !is_file($file)) {
            return new WriterRefusal(
                'writer.file.not-generated',
                "'{$file}' is not a regular file, so the writer did not generate it.",
                "Move it out of the output directory {$rootDir}.",
            );
        }

        if ($recordedSha256 === null) {
            return new WriterRefusal(
                'writer.file.not-generated',
                "'{$file}' exists and the writer did not generate it, so it is not overwritten.",
                "Move it out of the output directory {$rootDir}, or rename it.",
            );
        }

        $sha256 = hash_file('sha256', $file);
        if ($sha256 === false) {
            throw new \RuntimeException("seampact: reading the generated file '{$file}' failed; check its permissions.");
        }

        if ($sha256 !== $recordedSha256 && $onHandEdit === HandEditPolicy::Refuse) {
            return new WriterRefusal(
                'writer.file.edited',
                "'{$file}' was edited by hand since it was generated, so it is not overwritten or removed.",
                self::HAND_EDIT_FIX,
            );
        }

        return $sha256;
    }

    private static function normalizedBytes(string $contents): string
    {
        if (str_starts_with($contents, self::BYTE_ORDER_MARK)) {
            $contents = substr($contents, strlen(self::BYTE_ORDER_MARK));
        }

        $lineFeeds = str_replace(["\r\n", "\r"], "\n", $contents);

        return str_ends_with($lineFeeds, "\n") ? $lineFeeds : "{$lineFeeds}\n";
    }

    // The real path `$directory` has or will have once created: its deepest existing ancestor's real path, then the rest.
    private static function realPathOfMissing(string $directory): string
    {
        if (self::exists($directory)) {
            $real = realpath($directory);

            return $real === false ? $directory : $real;
        }

        $parent = dirname($directory);
        if ($parent === $directory) {
            return $directory;
        }

        return self::realPathOfMissing($parent) . '/' . basename($directory);
    }

    // True when the deepest existing directory above `$file` is, once links resolve, outside `$rootDir`.
    private static function leavesRoot(string $rootDir, string $file): bool
    {
        $directory = dirname($file);
        while (!self::exists($directory)) {
            // The output directory itself is not created yet, so nothing below it is a link.
            if ($directory === $rootDir) {
                return false;
            }
            $directory = dirname($directory);
        }

        $real = realpath($directory);

        return $real === false || !($real === $rootDir || str_starts_with($real, $rootDir . '/'));
    }

    private static function removeEmptyDirectories(string $rootDir, string $directory): void
    {
        if ($directory === $rootDir || !str_starts_with($directory, $rootDir . '/')) {
            return;
        }

        if ((scandir($directory) ?: []) !== ['.', '..']) {
            return;
        }

        if (!rmdir($directory)) {
            throw new \RuntimeException("seampact: removing the empty directory '{$directory}' failed; check its permissions.");
        }
        self::removeEmptyDirectories($rootDir, dirname($directory));
    }

    private static function exists(string $path): bool
    {
        return file_exists($path) || is_link($path);
    }

    private static function createDirectory(string $directory): void
    {
        if (!is_dir($directory) && !@mkdir($directory, self::DIRECTORY_MODE, true) && !is_dir($directory)) {
            throw new \RuntimeException("seampact: creating the output directory '{$directory}' failed; check its permissions.");
        }
    }

    private static function writeFile(string $path, string $bytes): void
    {
        if (file_put_contents($path, $bytes) !== strlen($bytes)) {
            throw new \RuntimeException("seampact: writing '{$path}' failed; check the disk space and the permissions.");
        }
    }
}
