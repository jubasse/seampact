<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * Runs `compile --config <app config> --out <directory>` of the private binary copy through `proc_open` with an
 * array command, so no shell reads it, from the app config's directory, with the contract's environment only.
 * The output directory is a fresh one created owner-only in the system temporary directory; only the
 * `<api>.ir.json` of each api asked for is read from it, then it is removed. Standard input and output are the
 * null device: the diagnostics are on standard error.
 */
final class BinaryRunner
{
    private const EXIT_COMPILED = 0;
    private const EXIT_REFUSED = 1;
    private const EXIT_USAGE = 2;

    private const KILL_SIGNAL = 9;

    // Standard error is kept up to this many bytes; the rest is counted.
    private const DIAGNOSTICS_BYTES_MAX = 1024 * 1024;

    private const POLL_MICROSECONDS = 20_000;

    private const OUTPUT_PREFIX = 'seampact-compile-';

    private const IR_SUFFIX = '.ir.json';

    private function __construct()
    {
    }

    /**
     * @param string $configFile the absolute path of the app config
     * @param list<string> $apis the apis of the app config, whose IR files are read
     * @param array<string, string> $parentEnvironment the variables of this process, filtered to the contract's
     * @throws BinaryRefusedException `binary.cache-unsafe`, `binary.hash-mismatch`, `binary.compile-timeout` or
     *     `binary.compile-failed`
     */
    public static function compile(
        InstalledBinary $binary,
        string $configFile,
        array $apis,
        float $timeoutSeconds,
        array $parentEnvironment,
        bool $windows,
    ): BinaryCompileOutput {
        $binary->refuseUnlessIntact();
        $outputDirectory = self::newOutputDirectory();

        try {
            [$exit, $diagnostics] = self::run(
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
     * @param array{code: int, signal: ?int} $exit
     * @param list<string> $apis
     */
    private static function output(array $exit, string $diagnostics, string $outputDirectory, array $apis): BinaryCompileOutput
    {
        if ($exit['signal'] !== null) {
            throw self::failed("was stopped by the signal {$exit['signal']}", $diagnostics);
        }

        if ($exit['code'] === self::EXIT_REFUSED || $exit['code'] === self::EXIT_USAGE) {
            return new BinaryCompileOutput($exit['code'], $diagnostics, []);
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

        return new BinaryCompileOutput(self::EXIT_COMPILED, $diagnostics, $irTextByApi);
    }

    /**
     * @param list<string> $command
     * @param array<string, string> $environment
     * @return array{array{code: int, signal: ?int}, string}
     */
    private static function run(array $command, string $directory, array $environment, float $timeoutSeconds, bool $windows): array
    {
        $nullDevice = $windows ? 'NUL' : '/dev/null';
        $descriptors = [0 => ['file', $nullDevice, 'r'], 1 => ['file', $nullDevice, 'w'], 2 => ['pipe', 'w']];
        $process = proc_open($command, $descriptors, $pipes, $directory, $environment, ['bypass_shell' => true]);

        if (!is_resource($process)) {
            throw self::failed('did not start', '');
        }

        stream_set_blocking($pipes[2], false);
        $deadline = hrtime(true) + (int) ($timeoutSeconds * 1e9);
        $diagnostics = '';
        $droppedBytes = 0;

        while (true) {
            $status = proc_get_status($process);
            self::collect($pipes[2], $diagnostics, $droppedBytes);

            if (!$status['running']) {
                break;
            }

            if (hrtime(true) > $deadline) {
                proc_terminate($process, self::KILL_SIGNAL);
                fclose($pipes[2]);
                proc_close($process);
                throw BinaryRefusedException::of(
                    BinaryFailureCode::CompileTimeout,
                    "The compiler binary ran past its deadline of {$timeoutSeconds} s and was stopped.",
                    'Run the compile again; if it hangs again, report it with the contract that makes it hang.',
                );
            }

            usleep(self::POLL_MICROSECONDS);
        }

        self::collect($pipes[2], $diagnostics, $droppedBytes);
        fclose($pipes[2]);
        proc_close($process);

        $shown = self::withoutControlCharacters($diagnostics);
        if ($droppedBytes > 0) {
            $shown .= "\n[{$droppedBytes} more bytes of diagnostics not shown]\n";
        }

        $signal = $status['signaled'] ? $status['termsig'] : null;

        return [['code' => $status['exitcode'], 'signal' => $signal], $shown];
    }

    /** @param resource $pipe */
    private static function collect($pipe, string &$diagnostics, int &$droppedBytes): void
    {
        $chunk = stream_get_contents($pipe);
        if ($chunk === false || $chunk === '') {
            return;
        }

        $room = self::DIAGNOSTICS_BYTES_MAX - strlen($diagnostics);
        $diagnostics .= substr($chunk, 0, max(0, $room));
        $droppedBytes += max(0, strlen($chunk) - max(0, $room));
    }

    private static function withoutControlCharacters(string $text): string
    {
        $text = preg_replace('/[\x00-\x08\x0b-\x1f\x7f]/', '', $text) ?? '';

        return preg_match('//u', $text) === 1 ? preg_replace('/[\x{80}-\x{9f}]/u', '', $text) ?? $text : $text;
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
        $directory = sys_get_temp_dir() . DIRECTORY_SEPARATOR . self::OUTPUT_PREFIX . bin2hex(random_bytes(8));

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
