<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * Runs `compile --config <app config> --out <directory>` of the private binary copy through `proc_open` with an
 * array command, so no shell reads it, from the app config's directory, with the contract's environment only.
 * Every path is made absolute before any check, so the child, which starts in another directory, gets the files
 * checked. The output directory is a fresh one created owner-only in the system temporary directory; only the
 * `<api>.ir.json` of each api asked for is read from it, then it is removed. Standard input is the null device;
 * the diagnostics are on standard error. Exits 1 (refused) and 2 (a usage error) are refused as
 * `binary.compile-refused` with the binary's diagnostics. `generate` and `check` on the app's OpenAPI documents run
 * the same way, their standard output kept as the lines to print.
 */
final class BinaryRunner
{
    private const EXIT_COMPILED = 0;
    private const EXIT_REFUSED = 1;
    private const EXIT_USAGE = 2;

    private const KILL_SIGNAL = 9;

    // Each output stream is kept up to this many bytes; the rest is counted.
    private const DIAGNOSTICS_BYTES_MAX = 1024 * 1024;

    private const POLL_MICROSECONDS = 20_000;

    private const OUTPUT_PREFIX = 'seampact-compile-';

    private const IR_SUFFIX = '.ir.json';

    // The api names of the app config schema: never a path separator or a `..`.
    private const API_NAME_PATTERN = '/^[A-Za-z][A-Za-z0-9_-]*$/D';

    // What replaces a byte that is not part of a valid UTF-8 sequence, before the control characters are removed.
    private const INVALID_BYTE_REPLACEMENT = '?';

    // One well-formed UTF-8 sequence (RFC 3629) in group 1, else any single byte.
    private const VALID_UTF8_SEQUENCE_OR_BYTE = '/([\x00-\x7F]|[\xC2-\xDF][\x80-\xBF]|\xE0[\xA0-\xBF][\x80-\xBF]'
        . '|[\xE1-\xEC\xEE\xEF][\x80-\xBF]{2}|\xED[\x80-\x9F][\x80-\xBF]|\xF0[\x90-\xBF][\x80-\xBF]{2}'
        . '|[\xF1-\xF3][\x80-\xBF]{3}|\xF4[\x80-\x8F][\x80-\xBF]{2})|./s';

    private function __construct()
    {
    }

    /**
     * @param string $configFile the path of the app config, made absolute against the working directory
     * @param list<string> $apis the apis of the app config, whose IR files are read
     * @param array<string, string> $parentEnvironment the variables of this process, filtered to the contract's
     * @throws BinaryRefusedException `binary.cache-unsafe`, `binary.hash-mismatch`, `binary.compile-refused`,
     *     `binary.compile-timeout` or `binary.compile-failed`
     */
    public static function compile(
        InstalledBinary $binary,
        string $configFile,
        array $apis,
        float $timeoutSeconds,
        array $parentEnvironment,
        bool $windows,
    ): BinaryCompileOutput {
        self::refuseUnsafeApiNames($apis);
        $configFile = AbsolutePath::resolved($configFile);
        self::refuseRelativeBinary($binary);
        $binary->refuseUnlessIntact();
        $outputDirectory = self::newOutputDirectory();

        try {
            [$exit, , $diagnostics] = self::run(
                [$binary->path, 'compile', '--config', $configFile, '--out', $outputDirectory],
                dirname($configFile),
                ChildEnvironment::of($parentEnvironment, $windows),
                $timeoutSeconds,
                $windows,
            );

            return self::output($exit, $diagnostics, $outputDirectory, $apis);
        } finally {
            self::removeOutputDirectory($outputDirectory);
        }
    }

    /**
     * Runs `generate` or `check` on the app config `$configFile`, from its directory, with the checks, environment
     * and deadline of `compile`: the binary writes or checks the config's OpenAPI documents and leaves the Composer
     * entries to this runner; an npm entry is its own refusal. Each `$bundleDirectories` item hands over, by source
     * name, a bundle this runner already fetched and checked (`--bundle-directory <source>=<dir>`); the binary checks
     * it again against the source's integrity and fetches nothing.
     *
     * @param array<string, string> $bundleDirectories
     * @param array<string, string> $parentEnvironment the variables of this process, filtered to the contract's
     * @throws BinaryRefusedException `binary.cache-unsafe`, `binary.hash-mismatch`, `binary.documents-refused`,
     *     `binary.compile-timeout` or `binary.compile-failed`
     */
    public static function documents(
        InstalledBinary $binary,
        string $configFile,
        DocumentsCommand $command,
        array $bundleDirectories,
        float $timeoutSeconds,
        array $parentEnvironment,
        bool $windows,
    ): BinaryDocumentsOutput {
        $configFile = AbsolutePath::resolved($configFile);
        self::refuseRelativeBinary($binary);
        $binary->refuseUnlessIntact();

        $arguments = [$binary->path, $command->value, '--config', $configFile];
        ksort($bundleDirectories, SORT_STRING);
        foreach ($bundleDirectories as $source => $directory) {
            array_push($arguments, '--bundle-directory', $source . '=' . AbsolutePath::resolved($directory));
        }

        [$exit, $stdout, $stderr] = self::run($arguments, dirname($configFile), ChildEnvironment::of($parentEnvironment, $windows), $timeoutSeconds, $windows);

        if ($exit['signal'] !== null) {
            throw self::failed("was stopped by the signal {$exit['signal']}", $stderr);
        }

        if ($exit['code'] === self::EXIT_REFUSED || $exit['code'] === self::EXIT_USAGE) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::DocumentsRefused,
                rtrim("The compiler binary exited with {$exit['code']} on the app's OpenAPI documents:\n{$stderr}{$stdout}"),
                'Fix what the diagnostics say, reading `seampact generate` there as `vendor/bin/seampact generate`: a document that differs is written again by it, then committed; a document edited by hand is not overwritten, so delete it first.',
            );
        }

        if ($exit['code'] !== self::EXIT_COMPILED) {
            throw self::failed("exited with the code {$exit['code']}", $stderr);
        }

        return new BinaryDocumentsOutput($stdout, $stderr);
    }

    /**
     * @param array{code: int, signal: ?int} $exit
     * @param list<string> $apis
     */
    private static function output(array $exit, string $diagnostics, string $outputDirectory, array $apis): BinaryCompileOutput
    {
        if ($exit['signal'] !== null) {
            throw self::failed("was stopped by the signal {$exit['signal']}", $diagnostics);
        }

        if ($exit['code'] === self::EXIT_REFUSED || $exit['code'] === self::EXIT_USAGE) {
            throw self::refused($exit['code'], $diagnostics);
        }

        if ($exit['code'] !== self::EXIT_COMPILED) {
            throw self::failed("exited with the code {$exit['code']}", $diagnostics);
        }

        $irTextByApi = [];
        foreach ($apis as $api) {
            $file = $outputDirectory . DIRECTORY_SEPARATOR . $api . self::IR_SUFFIX;
            $text = is_file($file) && !is_link($file) ? file_get_contents($file) : false;

            if ($text === false) {
                throw self::failed("exited with 0 and wrote no IR for the api '{$api}' ({$api}" . self::IR_SUFFIX . ')', $diagnostics);
            }

            $irTextByApi[$api] = $text;
        }

        return new BinaryCompileOutput($diagnostics, $irTextByApi);
    }

    /**
     * Standard output and error go to private temporary files, read once the child exits: a pipe would block on
     * Windows, where pipes cannot be read without blocking, and the deadline would not hold.
     *
     * @param list<string> $command
     * @param array<string, string> $environment
     * @return array{array{code: int, signal: ?int}, string, string} the exit, standard output and standard error
     */
    private static function run(array $command, string $directory, array $environment, float $timeoutSeconds, bool $windows): array
    {
        $nullDevice = $windows ? 'NUL' : '/dev/null';
        $outputFile = self::newStreamFile('.stdout');

        try {
            $errorFile = self::newStreamFile('.stderr');
        } catch (BinaryRefusedException $refused) {
            unlink($outputFile);
            throw $refused;
        }

        try {
            $descriptors = [0 => ['file', $nullDevice, 'r'], 1 => ['file', $outputFile, 'w'], 2 => ['file', $errorFile, 'w']];
            $process = proc_open($command, $descriptors, $pipes, $directory, $environment, ['bypass_shell' => true]);

            if (!is_resource($process)) {
                throw self::failed('did not start', '');
            }

            $status = self::waitForExit($process, $timeoutSeconds);

            return [
                ['code' => $status['exitcode'], 'signal' => $status['signaled'] ? $status['termsig'] : null],
                self::streamTextOf($outputFile),
                self::streamTextOf($errorFile),
            ];
        } finally {
            unlink($outputFile);
            unlink($errorFile);
        }
    }

    /**
     * @param resource $process
     * @return array{exitcode: int, signaled: bool, termsig: int}
     */
    private static function waitForExit($process, float $timeoutSeconds): array
    {
        $deadline = hrtime(true) + (int) ($timeoutSeconds * 1e9);

        while (true) {
            // Only the first status after the exit carries the exit code.
            $status = proc_get_status($process);
            if (!$status['running']) {
                proc_close($process);

                return $status;
            }

            if (hrtime(true) > $deadline) {
                proc_terminate($process, self::KILL_SIGNAL);
                proc_close($process);
                throw BinaryRefusedException::of(
                    BinaryFailureCode::CompileTimeout,
                    "The compiler binary ran past its deadline of {$timeoutSeconds} s and was stopped.",
                    'Run the compile again; if it hangs again, report it with the contract that makes it hang.',
                );
            }

            usleep(self::POLL_MICROSECONDS);
        }
    }

    private static function streamTextOf(string $streamFile): string
    {
        $size = filesize($streamFile);
        $kept = file_get_contents($streamFile, false, null, 0, self::DIAGNOSTICS_BYTES_MAX);
        $shown = self::withoutControlCharacters($kept === false ? '' : $kept);
        $dropped = ($size === false ? 0 : $size) - self::DIAGNOSTICS_BYTES_MAX;

        return $dropped > 0 ? $shown . "\n[{$dropped} more bytes of diagnostics not shown]\n" : $shown;
    }

    private static function newStreamFile(string $suffix): string
    {
        $file = self::temporaryPath($suffix);
        $handle = @fopen($file, 'x');

        if ($handle === false || !fclose($handle) || !chmod($file, 0600)) {
            throw self::failed("could not be given a file for its output ('{$file}' cannot be created)", '');
        }

        return $file;
    }

    // Invalid UTF-8 is replaced first, so the C1 controls (U+0080 to U+009F) are always found and removed.
    private static function withoutControlCharacters(string $text): string
    {
        $valid = preg_match('//u', $text) === 1 ? $text : self::withInvalidBytesReplaced($text);
        $text = preg_replace('/[\x00-\x08\x0b-\x1f\x7f]/', '', $valid) ?? '';

        return preg_replace('/[\x{80}-\x{9f}]/u', '', $text) ?? '';
    }

    private static function withInvalidBytesReplaced(string $text): string
    {
        return preg_replace_callback(
            self::VALID_UTF8_SEQUENCE_OR_BYTE,
            static fn (array $match): string => $match[1] ?? self::INVALID_BYTE_REPLACEMENT,
            $text,
            -1,
            $count,
            PREG_UNMATCHED_AS_NULL,
        ) ?? '';
    }

    // Below the system temporary directory, made absolute: a relative TMPDIR is resolved once here.
    private static function temporaryPath(string $suffix): string
    {
        return AbsolutePath::resolved(sys_get_temp_dir()) . DIRECTORY_SEPARATOR . self::OUTPUT_PREFIX . bin2hex(random_bytes(8)) . $suffix;
    }

    /** @param list<string> $apis */
    private static function refuseUnsafeApiNames(array $apis): void
    {
        foreach ($apis as $api) {
            if (preg_match(self::API_NAME_PATTERN, $api) !== 1) {
                throw new \InvalidArgumentException("The api name '{$api}' is not an api name of the app config schema (a letter, then letters, digits, `_` or `-`); its IR file is never read.");
            }
        }
    }

    private static function refuseRelativeBinary(InstalledBinary $binary): void
    {
        if (!AbsolutePath::isAbsolute($binary->path)) {
            throw self::failed("path '{$binary->path}' is relative, so the file checked and the file started could differ", '');
        }
    }

    private static function refused(int $exitCode, string $diagnostics): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::CompileRefused,
            "The compiler binary refused the compile with the exit code {$exitCode}. Its diagnostics:\n{$diagnostics}",
            'Fix what the diagnostics name in the app config or the contract, then run the compile again.',
        );
    }

    private static function failed(string $what, string $diagnostics): BinaryRefusedException
    {
        $tail = $diagnostics === '' ? '' : " Its diagnostics:\n{$diagnostics}";

        return BinaryRefusedException::of(
            BinaryFailureCode::CompileFailed,
            "The compiler binary {$what}.{$tail}",
            'Run the compile again; if it fails again, check that the binary is a seampact compiler build for this platform.',
        );
    }

    private static function newOutputDirectory(): string
    {
        $directory = self::temporaryPath('');

        if (!mkdir($directory, 0700) || !chmod($directory, 0700)) {
            throw self::failed("could not be given an output directory ('{$directory}' cannot be created)", '');
        }

        return $directory;
    }

    // The directory this runner created; links inside it are removed, never followed.
    private static function removeOutputDirectory(string $directory): void
    {
        foreach (scandir($directory) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $name;
            if (is_dir($path) && !is_link($path)) {
                self::removeOutputDirectory($path);
            } else {
                unlink($path);
            }
        }

        rmdir($directory);
    }
}
