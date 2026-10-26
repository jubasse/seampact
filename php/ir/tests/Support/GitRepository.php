<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

/** A local git repository a test creates, holding the valid bundle under a directory, committed and tagged. */
final class GitRepository
{
    /** @return array<string, string> an environment that keeps the user's git config out of the test */
    public static function environment(): array
    {
        return [
            'PATH' => (string) getenv('PATH'),
            'HOME' => sys_get_temp_dir(),
            'GIT_CONFIG_NOSYSTEM' => '1',
            'GIT_CONFIG_GLOBAL' => '/dev/null',
            'GIT_AUTHOR_NAME' => 'seampact',
            'GIT_AUTHOR_EMAIL' => 'seampact@example.test',
            'GIT_COMMITTER_NAME' => 'seampact',
            'GIT_COMMITTER_EMAIL' => 'seampact@example.test',
        ];
    }

    /** Creates the repository at `$path` with the valid bundle under `$directory`, tagged `$tag`; returns `$path`. */
    public static function withValidBundle(string $path, string $directory, string $tag): string
    {
        mkdir($path, 0700, true);
        self::git($path, ['init', '--quiet']);
        ValidBundle::writeFiles("{$path}/{$directory}");
        self::git($path, ['add', '.']);
        self::git($path, ['commit', '--quiet', '-m', 'Bundle.']);
        self::git($path, ['tag', $tag]);

        return $path;
    }

    public static function commitLinkAndTag(string $path, string $link, string $tag): void
    {
        symlink('/etc/passwd', "{$path}/{$link}");
        self::git($path, ['add', '.']);
        self::git($path, ['commit', '--quiet', '-m', 'Link.']);
        self::git($path, ['tag', $tag]);
    }

    /** @param list<string> $arguments */
    private static function git(string $path, array $arguments): void
    {
        $process = proc_open(['git', '-C', $path, ...$arguments], [1 => ['file', '/dev/null', 'w'], 2 => ['pipe', 'w']], $pipes, null, self::environment());
        $errors = is_resource($process) ? (string) stream_get_contents($pipes[2]) : 'git did not start';
        $exit = is_resource($process) ? proc_close($process) : 1;

        if ($exit !== 0) {
            throw new \RuntimeException("test: git " . implode(' ', $arguments) . " failed: {$errors}");
        }
    }
}
