<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\AppConfigReader;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Write\HandEditPolicy;

/**
 * The `vendor/bin/seampact` command line: `generate [--config <file>] [--force]` and `check [--config <file>]`, run
 * from the project's root directory. Exit 0 passes, 1 is a refusal or a drift, 2 a usage error. Nothing runs on
 * `composer install`: there is no Composer plugin.
 */
final class Command
{
    public const EXIT_PASSED = 0;
    public const EXIT_REFUSED = 1;
    public const EXIT_USAGE = 2;

    private const USAGE = "Usage: vendor/bin/seampact generate [--config <file>] [--force]\n"
        . "       vendor/bin/seampact check [--config <file>]\n";

    private function __construct()
    {
    }

    /**
     * @param list<string> $arguments the arguments after the command name
     * @param array<string, string> $environment
     * @param resource $stdout
     * @param resource $stderr
     */
    public static function run(array $arguments, string $projectDirectory, string $vendorDirectory, array $environment, $stdout, $stderr): int
    {
        $parsed = self::parsed($arguments);
        if (is_string($parsed)) {
            fwrite($stderr, "seampact: {$parsed}\n" . self::USAGE);

            return self::EXIT_USAGE;
        }

        [$command, $configFile, $force] = $parsed;
        $settings = new RunSettings(
            $projectDirectory,
            $configFile ?? $projectDirectory . '/' . AppConfigReader::FILE_NAME,
            $vendorDirectory,
            $environment,
        );

        $report = $command === 'generate'
            ? Runner::generate($settings, $force ? HandEditPolicy::Overwrite : HandEditPolicy::Refuse)
            : Runner::check($settings);

        foreach ($report->lines as $line) {
            fwrite($stdout, "{$line}\n");
        }
        foreach ($report->warnings as $warning) {
            fwrite($stderr, 'seampact warning: ' . ConfigProblem::text([$warning]) . "\n");
        }
        if ($report->problems !== []) {
            fwrite($stderr, ConfigProblem::text($report->problems) . "\n");

            return self::EXIT_REFUSED;
        }

        return self::EXIT_PASSED;
    }

    /**
     * @param list<string> $arguments
     * @return array{string, ?string, bool}|string the command, the config file and `--force`, or the usage error
     */
    private static function parsed(array $arguments): array|string
    {
        $command = array_shift($arguments);
        if ($command !== 'generate' && $command !== 'check') {
            return $command === null ? 'no command given.' : "unknown command '{$command}'.";
        }

        $configFile = null;
        $force = false;

        while ($arguments !== []) {
            $argument = array_shift($arguments);
            if ($argument === '--force' && $command === 'generate') {
                $force = true;
            } elseif ($argument === '--config' && $arguments !== []) {
                $configFile = array_shift($arguments);
            } else {
                return "unknown argument '{$argument}' for {$command}.";
            }
        }

        return [$command, $configFile, $force];
    }
}
