<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Binary\BinaryFailure;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\BinaryRunner;
use Seampact\Ir\Binary\DocumentsCommand;
use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\AppConfigEntry;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Config\EntryView;

/**
 * The app's seampact OpenAPI documents (ADR 0011 "Which OpenAPI documents exist"), which the pinned binary writes
 * and checks: unless `openapi` is `none`, those it lists, or without the key those of the apis its target entries
 * serve. A run that asks for none never installs the binary.
 */
final class Documents
{
    private const NO_DOCUMENTS = 'none';

    private const WHERE = 'openapi';

    private const TIMEOUT_SECONDS = 120.0;

    private const WARNING_PREFIX = 'warning: ';

    private function __construct()
    {
    }

    public static function asked(AppConfig $config): bool
    {
        if ($config->openapi === self::NO_DOCUMENTS) {
            return false;
        }

        return $config->openapi !== null || $config->entries !== [] || $config->otherEntries !== [];
    }

    /**
     * The sources the binary reads for the documents, by the rule of its own run: those holding the api of any
     * target entry, this runner's or another's, or of any document `openapi` lists. None without documents.
     *
     * @return list<string>
     */
    public static function sources(AppConfig $config): array
    {
        if (!self::asked($config)) {
            return [];
        }

        $listedApis = $config->openapi instanceof \stdClass ? array_map(strval(...), array_keys(get_object_vars($config->openapi))) : [];
        $entryRefs = array_map(static fn (AppConfigEntry $entry): array => $entry->apiRefs(), [...$config->entries, ...$config->otherEntries]);

        return EntryView::sourcesHoldingRefs($config, [...array_merge([], ...$entryRefs), ...$listedApis]);
    }

    /**
     * Asks the binary to write or check the documents, handing over each bundle source the run checked as its
     * checked cache entry; the binary fetches nothing. No documents: nothing runs.
     *
     * @return DocumentsRun|list<ConfigProblem>
     */
    public static function run(PreparedRun $prepared, RunSettings $settings, DocumentsCommand $command): DocumentsRun|array
    {
        if (!self::asked($prepared->config)) {
            return new DocumentsRun([], []);
        }

        [$bundleDirectories, $problems] = $prepared->contractApis->handedBundles();
        if ($problems !== []) {
            return $problems;
        }

        $binary = $prepared->contractApis->binary();
        if ($binary instanceof BinaryFailure) {
            return [RunProblems::ofBinary($binary, self::WHERE)];
        }

        try {
            $output = BinaryRunner::documents(
                $binary,
                $settings->configFile,
                $command,
                $bundleDirectories,
                self::TIMEOUT_SECONDS,
                $settings->environment,
                PHP_OS_FAMILY === 'Windows',
            );
        } catch (BinaryRefusedException $refused) {
            return [RunProblems::ofBinary($refused->failure, self::WHERE)];
        }

        return new DocumentsRun(
            array_map(static fn (string $line): string => "seampact: compiler: {$line}", self::printedLines($output->stdout)),
            array_map(
                static fn (string $line): string => str_starts_with($line, self::WARNING_PREFIX) ? substr($line, strlen(self::WARNING_PREFIX)) : $line,
                self::printedLines($output->stderr),
            ),
        );
    }

    /** @return list<string> */
    private static function printedLines(string $text): array
    {
        return array_values(array_filter(explode("\n", $text), static fn (string $line): bool => trim($line) !== ''));
    }
}
