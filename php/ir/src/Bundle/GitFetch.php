<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Config\ConfigPath;
use Seampact\Ir\Config\LocalSourcePolicy;

/**
 * The git-tag channel, as `fetch-git.ts`: a shallow fetch of the tag with the system `git` into a new bare
 * repository, then the files of the tag's tree read with `git ls-tree` and `git cat-file`, never through a work
 * tree, so `autocrlf`, attributes, smudge filters and LFS cannot change a byte. Only `https:` and `ssh` repositories
 * are fetched, plus local ones (`file:` or a path) when local sources are allowed; `ext::` is off. The tree is
 * untrusted: a link, a submodule, an unportable path or a case-fold duplicate is refused before anything is
 * written. Every command names the temporary repository by `--git-dir` and drops the variables that locate a
 * repository, so a run from a git hook (which exports `GIT_DIR`) never touches the user's repository.
 */
final readonly class GitFetch
{
    private const TEMPORARY_PREFIX = 'seampact-git-';

    private const FETCHED = 'FETCH_HEAD';

    private const REGULAR_FILE_MODES = ['100644', '100755'];

    private const URL_SCHEME = '/^([A-Za-z][A-Za-z0-9+.-]*):\/\//';

    private const DRIVE_PATH = '/^[A-Za-z]:[\\\\\/]/';

    // `[user@]host:path`, git's scp-like ssh form: a colon before any slash, after a host longer than a drive letter.
    private const SCP_LIKE = '/^[^\/:]{2,}:/';

    private const REMOTE_PROTOCOLS = 'https:ssh';

    private const LOCAL_PROTOCOL = 'file';

    private const TIMEOUT_SECONDS = 60.0;

    // ssh would otherwise ask for a host key or a passphrase on the terminal, which `GIT_TERMINAL_PROMPT` does not cover.
    private const NON_INTERACTIVE_SSH = 'ssh -o BatchMode=yes';

    private const REPOSITORY_LOCATING_VARIABLES = [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_COMMON_DIR',
        'GIT_NAMESPACE',
        'GIT_QUARANTINE_PATH',
    ];

    private const POLL_MICROSECONDS = 10_000;

    /** @param array<string, string> $environment the variables of this process, which git reads */
    public function __construct(private array $environment, private float $timeoutSeconds = self::TIMEOUT_SECONDS)
    {
    }

    /** Why the source cannot be fetched before any git command runs: its URL, its tag, its directory. */
    public static function sourceProblem(GitSource $source, LocalSourcePolicy $localSources): ?BundleFailure
    {
        $quotedUrl = BundleText::quoted(PrintableUrl::of($source->url));
        $scheme = self::schemeOf($source->url);

        if ($scheme !== null && !in_array($scheme, ['https', 'ssh', self::LOCAL_PROTOCOL], true)) {
            return new BundleFailure(
                BundleFailureCode::GitUrl,
                "The git URL {$quotedUrl} uses '{$scheme}:'; a bundle is fetched over https: or ssh only.",
                'Name the repository by its https: or ssh URL.',
            );
        }

        if (self::isLocalRepository($source->url) && $localSources === LocalSourcePolicy::Refuse) {
            return new BundleFailure(
                BundleFailureCode::SourceLocal,
                "The git repository {$quotedUrl} is local, and local sources are refused here.",
                'Name the repository by its https: or ssh URL.',
            );
        }

        if (self::directoryPrefix($source->directory) === null) {
            return new BundleFailure(
                BundleFailureCode::GitDirectory,
                'The git directory ' . BundleText::quoted($source->directory ?? '') . ' is not a relative path inside the repository.',
                "Name the bundle directory relative to the repository root, without '.', '..' or a backslash.",
            );
        }

        if (str_starts_with($source->tag, '-') || str_contains($source->tag, '..')) {
            return new BundleFailure(
                BundleFailureCode::GitTag,
                'The git tag ' . BundleText::quoted($source->tag) . ' is not a tag name.',
                'Name the tag the bundle was committed under.',
            );
        }

        return null;
    }

    /**
     * The bundle directory of the tag's tree, written into a new private temporary directory the caller removes with
     * `PrivateDirectory::remove`, or why it could not be fetched. `$baseDirectory` is where a local path is relative to.
     *
     * @return array{string, string}|BundleFailure the bundle directory and the temporary directory holding it
     */
    public function fetch(GitSource $source, string $baseDirectory, LocalSourcePolicy $localSources): array|BundleFailure
    {
        $problem = self::sourceProblem($source, $localSources);
        if ($problem !== null) {
            return $problem;
        }

        $prefix = self::directoryPrefix($source->directory) ?? '';
        $temporary = PrivateDirectory::create(sys_get_temp_dir(), self::TEMPORARY_PREFIX);
        $repository = "{$temporary}/repository";
        $environment = $this->gitEnvironment($localSources);

        try {
            $this->git($repository, $environment, ['init', '--quiet', '--bare']);
            $this->git($repository, $environment, [
                'fetch', '--quiet', '--depth', '1', '--no-tags', '--',
                self::repositoryUrl($source->url, $baseDirectory), "refs/tags/{$source->tag}",
            ]);

            $failure = $this->writeTree($repository, $environment, $prefix, "{$temporary}/files");
        } catch (GitFailedException $error) {
            PrivateDirectory::remove($temporary);

            return new BundleFailure(
                BundleFailureCode::GitFailed,
                "Fetching tag '{$source->tag}' of " . BundleText::quoted(PrintableUrl::of($source->url)) . ' with git failed: ' . BundleText::quoted($error->getMessage()) . '.',
                'Check the URL, the tag and your access to the repository, and that `git` is on the PATH.',
            );
        }

        if ($failure !== null) {
            PrivateDirectory::remove($temporary);

            return $failure;
        }

        return ["{$temporary}/files", $temporary];
    }

    private static function schemeOf(string $url): ?string
    {
        return preg_match(self::URL_SCHEME, $url, $match) === 1 ? strtolower($match[1]) : null;
    }

    private static function isLocalRepository(string $url): bool
    {
        $scheme = self::schemeOf($url);
        if ($scheme !== null) {
            return $scheme === self::LOCAL_PROTOCOL;
        }

        return preg_match(self::DRIVE_PATH, $url) === 1 || preg_match(self::SCP_LIKE, $url) !== 1;
    }

    // A local path as a `file:` URL, relative to the base directory; any other URL as written.
    private static function repositoryUrl(string $url, string $baseDirectory): string
    {
        if (!self::isLocalRepository($url) || self::schemeOf($url) !== null) {
            return $url;
        }

        $path = ConfigPath::resolve($baseDirectory, $url);

        // A drive path takes a third slash: `file:///C:/repository`.
        return 'file://' . (str_starts_with($path, '/') ? $path : "/{$path}");
    }

    // `$directory` as a tree path prefix (`''` for the root, else `a/b/`), or null when it is not a plain relative path.
    private static function directoryPrefix(?string $directory): ?string
    {
        if ($directory === null) {
            return '';
        }

        $segments = explode('/', rtrim($directory, '/'));
        foreach ($segments as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..' || str_contains($segment, '\\')) {
                return null;
            }
        }

        return implode('/', $segments) . '/';
    }

    /** @return array<string, string> the user's environment, less every variable that would point git elsewhere */
    private function gitEnvironment(LocalSourcePolicy $localSources): array
    {
        $environment = array_diff_key($this->environment, array_flip(self::REPOSITORY_LOCATING_VARIABLES));
        $environment['GIT_ALLOW_PROTOCOL'] = $localSources === LocalSourcePolicy::Allow
            ? self::REMOTE_PROTOCOLS . ':' . self::LOCAL_PROTOCOL
            : self::REMOTE_PROTOCOLS;
        $environment['GIT_TERMINAL_PROMPT'] = '0';
        $environment['GIT_SSH_COMMAND'] = $this->environment['GIT_SSH_COMMAND'] ?? self::NON_INTERACTIVE_SSH;

        return $environment;
    }

    /** @param array<string, string> $environment */
    private function writeTree(string $repository, array $environment, string $prefix, string $target): ?BundleFailure
    {
        $listing = $this->git($repository, $environment, ['ls-tree', '-r', '-z', '--full-tree', self::FETCHED]);
        $files = self::treeFiles($listing, $prefix);
        if ($files instanceof BundleFailure) {
            return $files;
        }

        $total = 0;
        foreach ($files as $path => $objectId) {
            $bytes = $this->git($repository, $environment, ['cat-file', 'blob', $objectId]);
            $total += strlen($bytes);
            if ($total > BundleLayout::EXTRACTED_BYTES_MAX) {
                return new BundleFailure(
                    BundleFailureCode::ArchiveExtractedTooLarge,
                    "The tag's bundle files hold more than " . BundleLayout::EXTRACTED_BYTES_MAX . ' bytes.',
                    BundleLayout::NOT_A_BUNDLE_FIX,
                    null,
                    (string) BundleLayout::EXTRACTED_BYTES_MAX,
                );
            }

            $file = "{$target}/{$path}";
            if (!is_dir(dirname($file)) && !mkdir(dirname($file), 0700, true) && !is_dir(dirname($file))) {
                throw new \RuntimeException("bundle: creating '" . dirname($file) . "' failed; check the temporary directory.");
            }

            $handle = fopen($file, 'xb');
            if ($handle === false || fwrite($handle, $bytes) !== strlen($bytes) || !fclose($handle)) {
                throw new \RuntimeException("bundle: writing '{$file}' failed; check the temporary directory.");
            }
        }

        if ($files === [] && !mkdir($target, 0700) && !is_dir($target)) {
            throw new \RuntimeException("bundle: creating '{$target}' failed; check the temporary directory.");
        }

        return null;
    }

    /** @return array<string, string>|BundleFailure each file below `$prefix` and its object id, each checked */
    private static function treeFiles(string $listing, string $prefix): array|BundleFailure
    {
        $files = [];
        $folded = [];

        foreach (explode("\0", $listing) as $line) {
            $tab = strpos($line, "\t");
            if ($line === '' || $tab === false) {
                continue;
            }

            [$mode, $type, $objectId] = array_pad(explode(' ', substr($line, 0, $tab)), 3, '');
            $fullPath = substr($line, $tab + 1);
            if (!str_starts_with($fullPath, $prefix)) {
                continue;
            }

            $path = substr($fullPath, strlen($prefix));
            $failure = self::entryFailure($path, $mode, $type, $folded);
            if ($failure !== null) {
                return $failure;
            }

            $folded[BundlePath::fold($path)] = true;
            $files[$path] = $objectId;

            if (count($files) > BundleLayout::ENTRIES_MAX) {
                return new BundleFailure(
                    BundleFailureCode::ArchiveTooManyEntries,
                    "The tag's bundle directory holds more than " . BundleLayout::ENTRIES_MAX . ' files.',
                    BundleLayout::NOT_A_BUNDLE_FIX,
                    null,
                    (string) BundleLayout::ENTRIES_MAX,
                );
            }
        }

        return $files;
    }

    /** @param array<string, true> $folded */
    private static function entryFailure(string $path, string $mode, string $type, array $folded): ?BundleFailure
    {
        $quoted = BundleText::quoted($path);

        if ($type !== 'blob' || !in_array($mode, self::REGULAR_FILE_MODES, true)) {
            return new BundleFailure(
                BundleFailureCode::ArchiveEntryType,
                "{$quoted} is a link or a submodule in the tag's tree; a bundle holds regular files only.",
                "Commit the bundle's files as regular files.",
                $path,
            );
        }

        $problem = $path === BundleLayout::MANIFEST_FILE ? null : BundlePath::problem($path);
        if ($problem !== null) {
            return new BundleFailure(
                BundleFailureCode::ArchiveEntryPath,
                "{$quoted} in the tag's tree is not a bundle path: {$problem}.",
                'Point `directory` at the bundle directory, which holds the manifest, `sources/` and `ir/` only.',
                $path,
            );
        }

        if (isset($folded[BundlePath::fold($path)])) {
            return new BundleFailure(
                BundleFailureCode::ArchiveEntryDuplicate,
                "{$quoted} differs only by letter case from another file of the tag's tree.",
                'Keep one of the two files.',
                $path,
            );
        }

        return null;
    }

    /**
     * Runs `git` on the temporary repository, with an argument list (no shell), and returns its output.
     *
     * @param array<string, string> $environment
     * @param list<string> $arguments
     * @throws GitFailedException
     */
    private function git(string $repository, array $environment, array $arguments): string
    {
        $command = ['git', '-c', 'protocol.ext.allow=never', "--git-dir={$repository}", ...$arguments];
        $process = @proc_open($command, [0 => ['file', self::nullDevice(), 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $environment);
        if (!is_resource($process)) {
            throw new GitFailedException('git could not start');
        }

        [$output, $errors, $exitCode] = $this->collected($process, $pipes[1], $pipes[2]);
        if ($exitCode !== 0) {
            throw new GitFailedException(trim($errors) === '' ? "it exited with {$exitCode}" : trim($errors));
        }

        return $output;
    }

    /**
     * @param resource $process
     * @param resource $stdout
     * @param resource $stderr
     * @return array{string, string, int}
     * @throws GitFailedException
     */
    private function collected($process, $stdout, $stderr): array
    {
        stream_set_blocking($stdout, false);
        stream_set_blocking($stderr, false);
        $deadline = microtime(true) + $this->timeoutSeconds;
        $output = '';
        $errors = '';
        $exitCode = -1;

        while (true) {
            $output .= (string) stream_get_contents($stdout);
            $errors .= (string) stream_get_contents($stderr);
            if (strlen($output) > BundleLayout::EXTRACTED_BYTES_MAX) {
                proc_terminate($process, 9);
                proc_close($process);
                throw new GitFailedException('it wrote more than ' . BundleLayout::EXTRACTED_BYTES_MAX . ' bytes');
            }

            $status = proc_get_status($process);
            if (!$status['running']) {
                $exitCode = $status['exitcode'];
                $output .= (string) stream_get_contents($stdout);
                $errors .= (string) stream_get_contents($stderr);
                break;
            }

            if (microtime(true) > $deadline) {
                proc_terminate($process, 9);
                proc_close($process);
                throw new GitFailedException('it took over ' . (int) round($this->timeoutSeconds * 1000) . ' ms');
            }

            usleep(self::POLL_MICROSECONDS);
        }

        fclose($stdout);
        fclose($stderr);
        proc_close($process);

        return [$output, $errors, $exitCode];
    }

    private static function nullDevice(): string
    {
        return PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null';
    }
}
