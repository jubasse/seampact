<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Ir\Write\GeneratedFile;

/** `php -l` on generated files, as CI lints the golden trees. */
final class PhpLint
{
    private const PHP_SUFFIX = '.php';

    /**
     * The lint error of each PHP file that does not parse, keyed by its path.
     *
     * @param list<GeneratedFile> $files
     * @return array<string, string>
     */
    public static function failures(array $files): array
    {
        $directory = sys_get_temp_dir() . '/seampact-lint-' . bin2hex(random_bytes(6));
        if (!mkdir($directory) && !is_dir($directory)) {
            throw new \RuntimeException("Could not create the lint directory {$directory}.");
        }

        $failures = [];
        try {
            foreach ($files as $index => $file) {
                if (!str_ends_with($file->path, self::PHP_SUFFIX)) {
                    continue;
                }

                $failure = self::lintFailure("{$directory}/{$index}.php", $file->contents);
                if ($failure !== null) {
                    $failures[$file->path] = $failure;
                }
            }
        } finally {
            array_map(unlink(...), glob("{$directory}/*.php") ?: []);
            rmdir($directory);
        }

        return $failures;
    }

    private static function lintFailure(string $path, string $contents): ?string
    {
        file_put_contents($path, $contents);
        exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($path) . ' 2>&1', $output, $exitCode);

        return $exitCode === 0 ? null : implode("\n", $output);
    }
}
