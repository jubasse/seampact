<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/** The paths a target may generate: relative POSIX paths that stay inside its output root, each once. */
final class GeneratedPaths
{
    private function __construct()
    {
    }

    /** Why `$path` is not a relative POSIX path that stays inside the output directory, or null when it is. */
    public static function unsafeReason(string $path): ?string
    {
        return match (true) {
            $path === '' => 'it is empty',
            str_contains($path, '\\') => "it contains a backslash; paths use '/'",
            str_starts_with($path, '/') || preg_match('/^[A-Za-z]:/', $path) === 1 => 'it has an absolute prefix',
            str_contains($path, "\0") => 'it contains a NUL character',
            array_intersect(explode('/', $path), ['', '.', '..']) !== [] => "it has an empty, '.' or '..' segment",
            default => null,
        };
    }

    /**
     * The key two paths share on a case-insensitive file system. Lower, upper, then lower case: the same answer in
     * the four writers (a plain case fold treats the capital sharp s and the dotless i differently), as ADR 0015 says.
     */
    public static function caseFolded(string $path): string
    {
        return mb_strtolower(mb_strtoupper(mb_strtolower($path, 'UTF-8'), 'UTF-8'), 'UTF-8');
    }

    /**
     * Each unsafe, duplicate or reserved path refused, else the files in code-unit order of path.
     *
     * @param list<GeneratedFile> $files
     * @return list<GeneratedFile>|list<WriterRefusal>
     */
    public static function checked(array $files): array
    {
        $seen = ['exact' => [], 'files' => [], 'directories' => []];
        $refusals = [];

        foreach ($files as $file) {
            $unusable = self::unsafeReason($file->path) ?? (preg_match('//u', $file->path) === 1 ? null : 'it is not UTF-8');
            $reason = $unusable ?? self::collisionReason($file->path, $seen);

            if ($reason !== null) {
                $refusals[] = new WriterRefusal(
                    'file.path.invalid',
                    "The target generated the path '{$file->path}', and {$reason}.",
                    "Report this to the target's maintainers, or, if two paths differ only by letter case, rename one of the two contract names: a target emits distinct relative POSIX paths inside its output root.",
                );
            }

            if ($unusable === null) {
                $seen = self::remembered($file->path, $seen);
            }
        }

        if ($refusals !== []) {
            return $refusals;
        }

        usort($files, static fn (GeneratedFile $left, GeneratedFile $right): int => CodeUnitOrder::compare($left->path, $right->path));

        return $files;
    }

    /**
     * Each directory of the path, from the outermost: `a/b/c.php` has `a` and `a/b`.
     *
     * @return list<string>
     */
    private static function directoryPrefixes(string $path): array
    {
        $segments = explode('/', $path);
        $prefixes = [];

        for ($count = 1; $count < count($segments); $count++) {
            $prefixes[] = implode('/', array_slice($segments, 0, $count));
        }

        return $prefixes;
    }

    /**
     * @param array{exact: array<string, true>, files: array<string, string>, directories: array<string, string>} $seen
     * @return array{exact: array<string, true>, files: array<string, string>, directories: array<string, string>}
     */
    private static function remembered(string $path, array $seen): array
    {
        $seen['exact'][$path] = true;
        $seen['files'][self::caseFolded($path)] ??= $path;

        foreach (self::directoryPrefixes($path) as $directory) {
            $seen['directories'][self::caseFolded($directory)] ??= $directory;
        }

        return $seen;
    }

    /** @param array{exact: array<string, true>, files: array<string, string>, directories: array<string, string>} $seen */
    private static function collisionReason(string $path, array $seen): ?string
    {
        if (isset($seen['exact'][$path])) {
            return 'it is generated twice';
        }

        $folded = self::caseFolded($path);

        if (isset($seen['files'][$folded])) {
            return "it differs only by letter case from '{$seen['files'][$folded]}'";
        }

        if (isset($seen['directories'][$folded])) {
            return "it is a file, and an earlier path uses '{$seen['directories'][$folded]}' as a directory";
        }

        return self::directoryReason($path, $seen)
            ?? (basename($path) === WriterManifest::FILE_NAME ? "'" . WriterManifest::FILE_NAME . "' is the writer's manifest" : null);
    }

    /** @param array{exact: array<string, true>, files: array<string, string>, directories: array<string, string>} $seen */
    private static function directoryReason(string $path, array $seen): ?string
    {
        foreach (self::directoryPrefixes($path) as $directory) {
            $folded = self::caseFolded($directory);

            if (isset($seen['files'][$folded])) {
                return "its directory '{$directory}' is also the file '{$seen['files'][$folded]}'";
            }

            if (isset($seen['directories'][$folded]) && $seen['directories'][$folded] !== $directory) {
                return "its directory '{$directory}' differs only by letter case from the directory '{$seen['directories'][$folded]}' of an earlier path";
            }
        }

        return null;
    }
}
