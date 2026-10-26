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
     * Each unsafe, duplicate or reserved path refused, else the files in code-unit order of path.
     *
     * @param list<GeneratedFile> $files
     * @return list<GeneratedFile>|list<WriterRefusal>
     */
    public static function checked(array $files): array
    {
        $seen = [];
        $refusals = [];

        foreach ($files as $file) {
            $reason = self::unsafeReason($file->path) ?? match (true) {
                preg_match('//u', $file->path) !== 1 => 'it is not UTF-8',
                isset($seen[$file->path]) => 'it is generated twice',
                basename($file->path) === WriterManifest::FILE_NAME => "'" . WriterManifest::FILE_NAME . "' is the writer's manifest",
                default => null,
            };

            if ($reason !== null) {
                $refusals[] = new WriterRefusal(
                    'file.path.invalid',
                    "The target generated the path '{$file->path}', and {$reason}.",
                    "Report this to the target's maintainers: a target emits distinct relative POSIX paths inside its output root.",
                );
            }
            $seen[$file->path] = true;
        }

        if ($refusals !== []) {
            return $refusals;
        }

        usort($files, static fn (GeneratedFile $left, GeneratedFile $right): int => CodeUnitOrder::compare($left->path, $right->path));

        return $files;
    }
}
