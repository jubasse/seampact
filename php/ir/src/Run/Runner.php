<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\CacheRoot;
use Seampact\Ir\Binary\PhpRuntimeCheck;
use Seampact\Ir\Binary\RootPackage;
use Seampact\Ir\Bundle\BundleFetcher;
use Seampact\Ir\Bundle\GitFetch;
use Seampact\Ir\Bundle\ReleaseFetch;
use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\AppConfigEntry;
use Seampact\Ir\Config\AppConfigReader;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Config\EntryView;
use Seampact\Ir\Config\JsonValue;
use Seampact\Ir\Config\LocalSourcePolicy;
use Seampact\Ir\Config\SourceApi;
use Seampact\Ir\Read\IrMalformedException;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Read\IrRefusal;
use Seampact\Ir\Read\IrRefusedException;
use Seampact\Ir\Write\GeneratedFile;
use Seampact\Ir\Write\GeneratedHeader;
use Seampact\Ir\Write\GeneratedWriter;
use Seampact\Ir\Write\HandEditPolicy;
use Seampact\Ir\Write\PlannedWrite;
use Seampact\Ir\Write\WriterRefusal;

/**
 * `vendor/bin/seampact generate` and `check`: reads the app config, gets the IR of each source the PHP entries use,
 * then generates each entry with the target its `use` names and plans its write (ADR 0015 "Writing files"). Generate
 * writes only when every entry planned, so one refusal leaves every directory as it was; check compares the plans
 * with the files on disk at the `checks.generated` level and writes nothing. The PHP version check runs first.
 */
final class Runner
{
    private const WAITS_CODE = 'config.key.waits';

    private const NO_DOCUMENTS = 'none';

    private const ERROR = 'error';

    private const DISABLED = 'disabled';

    private const HAND_EDIT_CODES = ['writer.file.edited', 'writer.file.not-generated'];

    private const GENERATE_FIX = 'Run `vendor/bin/seampact generate` and commit the result, or set `checks.generated` to `warning` or `disabled` in the app config.';

    private function __construct()
    {
    }

    public static function generate(RunSettings $settings, HandEditPolicy $onHandEdit): RunReport
    {
        $prepared = self::prepare($settings, $onHandEdit);
        if (is_array($prepared)) {
            return RunReport::refused($prepared);
        }

        $problems = array_merge(...array_map(static fn (EntryPlan $plan): array => $plan->allProblems(), $prepared->plans));
        if ($problems !== []) {
            return RunReport::refused($problems);
        }

        $lines = [];
        foreach ($prepared->plans as $plan) {
            if ($plan->write !== null) {
                $written = GeneratedWriter::commit($plan->write);
                $lines[] = "seampact: entry '{$plan->entryId}' wrote " . count($written->written) . ' file(s), kept ' . count($written->unchanged)
                    . ', removed ' . count($written->removed) . " in {$plan->write->rootDir}.";
            }
        }

        return new RunReport([...$lines, ...self::leftEntries($prepared->config)], [], []);
    }

    public static function check(RunSettings $settings): RunReport
    {
        $prepared = self::prepare($settings, HandEditPolicy::Refuse);
        if (is_array($prepared)) {
            return RunReport::refused($prepared);
        }

        $lines = array_map(
            static fn (array $bundle): string => "seampact: source '{$bundle[0]}' passes the pinned-bundle check, integrity {$bundle[1]}.",
            $prepared->checkedBundles,
        );
        $level = JsonValue::string($prepared->config->checks, 'generated') ?? self::ERROR;
        $errors = [];
        $warnings = [];

        foreach ($prepared->plans as $plan) {
            [$unreadable, $drift] = self::drift($plan);
            array_push($errors, ...$unreadable);

            if ($drift === null || $level === self::DISABLED) {
                continue;
            }

            if ($level === self::ERROR) {
                $errors[] = $drift;
            } else {
                $warnings[] = $drift;
            }
        }

        $ignored = JsonValue::strings($prepared->config->warnings, 'ignore') ?? [];
        $printed = array_values(array_filter($warnings, static fn (ConfigProblem $warning): bool => !in_array($warning->code, $ignored, true)));
        $matched = $errors === [] ? ['seampact: the generated files match the files on disk.'] : [];

        return new RunReport([...$lines, ...$matched], $printed, $errors);
    }

    /** @return PreparedRun|list<ConfigProblem> */
    private static function prepare(RunSettings $settings, HandEditPolicy $onHandEdit): PreparedRun|array
    {
        try {
            $root = RootPackage::locate($settings->projectDirectory, $settings->environment);
            PhpRuntimeCheck::check(PHP_VERSION, $root->phpPatched());
        } catch (BinaryRefusedException $refused) {
            return [RunProblems::ofBinary($refused->failure, 'php')];
        }

        $config = AppConfigReader::readFile($settings->configFile);
        if (is_array($config)) {
            return $config;
        }

        $problems = [...self::waitingForms($config), ...EntryView::unknownSourceProblems($config)];
        $psr4 = Psr4Namespaces::of($root->composerFile);
        if ($config->entries !== []) {
            $outDirProblem = $psr4->outDirProblem($config->outDir, $config->displayName);
            if ($outDirProblem !== null) {
                $problems[] = $outDirProblem;
            }
        }

        $discovery = TargetDiscovery::of($settings->vendorDirectory);
        if ($discovery instanceof ConfigProblem) {
            return [...$problems, $discovery];
        }

        $targets = [];
        foreach ($config->entries as $entry) {
            $target = $discovery->target($entry->use(), $entry->id());
            if ($target instanceof ConfigProblem) {
                $problems[] = $target;
            } else {
                $targets[$entry->id()] = $target;
            }
        }

        if ($problems !== []) {
            return $problems;
        }

        $contractApis = self::contractApis($settings, $config, $root);
        if (!$contractApis instanceof ContractApis) {
            return $contractApis;
        }

        $apis = $contractApis->read($config, EntryView::usedSources($config));
        if ($apis !== [] && $apis[0] instanceof ConfigProblem) {
            return array_values(array_filter($apis, static fn (object $item): bool => $item instanceof ConfigProblem));
        }

        $sourceApis = array_values(array_filter($apis, static fn (object $item): bool => $item instanceof SourceApi));
        $plans = array_map(
            static fn (AppConfigEntry $entry): EntryPlan => self::plan($entry, $targets[$entry->id()], $sourceApis, $psr4, $onHandEdit),
            $config->entries,
        );

        return new PreparedRun($config, $contractApis->checkedBundles, $plans);
    }

    /** @return ContractApis|list<ConfigProblem> */
    private static function contractApis(RunSettings $settings, AppConfig $config, RootPackage $root): ContractApis|array
    {
        try {
            $cacheRoot = CacheRoot::locate($settings->environment, PHP_OS_FAMILY === 'Windows');
        } catch (BinaryRefusedException $refused) {
            return [RunProblems::ofBinary($refused->failure, 'bundle cache')];
        }

        $fetcher = new BundleFetcher($cacheRoot, new ReleaseFetch(ReleaseFetch::DEADLINE_SECONDS, $settings->caFile), new GitFetch($settings->environment));

        return new ContractApis(
            $fetcher,
            LocalSourcePolicy::of($config->allowLocal, $settings->environment),
            $root,
            $settings->vendorDirectory,
            $settings->environment,
        );
    }

    /**
     * The app config's forms this release does not serve yet, each refused by name with what brings it: seampact's
     * OpenAPI documents, written by the pinned binary in a later release.
     *
     * @return list<ConfigProblem>
     */
    private static function waitingForms(AppConfig $config): array
    {
        if ($config->entries === [] || $config->openapi === self::NO_DOCUMENTS) {
            return [];
        }

        return [new ConfigProblem(
            self::WAITS_CODE,
            "seampact's OpenAPI documents are not written by vendor/bin/seampact yet; they come with the documents of the pinned compiler binary. An app with a server target writes them unless `openapi` is `none`.",
            'Set `openapi: none` for now; the framework\'s own document is not touched.',
            "{$config->displayName} openapi",
        )];
    }

    /** @param list<SourceApi> $apis */
    private static function plan(AppConfigEntry $entry, InstalledTarget $target, array $apis, Psr4Namespaces $psr4, HandEditPolicy $onHandEdit): EntryPlan
    {
        $view = EntryView::of($entry, $apis);
        if ($view->problems !== []) {
            return new EntryPlan($entry->id(), null, [], $view->problems);
        }

        $files = [];
        $problems = [];
        foreach ($view->apis as $api) {
            $generated = self::generatedApi($entry, $target, $api, $psr4);
            if ($generated !== [] && $generated[0] instanceof ConfigProblem) {
                array_push($problems, ...array_filter($generated, static fn (object $item): bool => $item instanceof ConfigProblem));
                continue;
            }

            array_push($files, ...array_filter($generated, static fn (object $item): bool => $item instanceof GeneratedFile));
        }

        if ($problems !== []) {
            return new EntryPlan($entry->id(), null, [], $problems);
        }

        $write = GeneratedWriter::plan($entry->root, $entry->id(), $files, $onHandEdit);

        return $write instanceof PlannedWrite
            ? new EntryPlan($entry->id(), $write, [], [])
            : new EntryPlan($entry->id(), null, $write, []);
    }

    /** @return list<GeneratedFile>|list<ConfigProblem> the api's files with their paths below the entry root */
    private static function generatedApi(AppConfigEntry $entry, InstalledTarget $target, SourceApi $api, Psr4Namespaces $psr4): array
    {
        $where = "entry '{$entry->id()}' api '{$api->api}'";
        $subdirectory = $entry->namesSeveralApis() ? $api->api : '';
        $outputDirectory = $subdirectory === '' ? $entry->root : "{$entry->root}/{$subdirectory}";
        $namespace = $psr4->namespaceOf($outputDirectory, $where);
        if ($namespace instanceof ConfigProblem) {
            return [$namespace];
        }

        try {
            $ir = IrReader::readDocument(JsonValue::copy($api->ir), $target->generator->irSupport());
            $files = $target->generator->generate($ir, new TargetEntry(
                $entry->id(),
                $entry->use(),
                $api->api,
                $entry->document(),
                $entry->options(),
                $entry->artefacts(),
                $outputDirectory,
                $namespace,
            ));
        } catch (IrRefusedException $refused) {
            return array_map(
                static fn (IrRefusal $refusal): ConfigProblem => RunProblems::ofIr($refusal, $entry->use(), $where),
                $refused->refusals,
            );
        } catch (IrMalformedException $malformed) {
            return [new ConfigProblem('ir.malformed', $malformed->getMessage(), 'Report the source of this IR: it does not read.', $where)];
        } catch (GenerationRefusedException $refused) {
            return $refused->problems;
        }

        $headed = GeneratedHeader::added($files, $target->package, $target->version, $api->api);
        if ($headed !== [] && $headed[0] instanceof WriterRefusal) {
            return array_map(
                static fn (object $refusal): ConfigProblem => $refusal instanceof WriterRefusal ? RunProblems::ofWriter($refusal, $where) : throw new \LogicException('seampact: mixed header outcome.'),
                $headed,
            );
        }

        return array_map(
            static fn (object $file): GeneratedFile => $file instanceof GeneratedFile
                ? new GeneratedFile($subdirectory === '' ? $file->path : "{$subdirectory}/{$file->path}", $file->contents)
                : throw new \LogicException('seampact: mixed header outcome.'),
            $headed,
        );
    }

    // A hand-edited or foreign file is drift the writer names; any other refusal means the check cannot compare.
    /** @return array{list<ConfigProblem>, ?ConfigProblem} the problems that keep the check from comparing, and the drift */
    private static function drift(EntryPlan $plan): array
    {
        if ($plan->problems !== []) {
            return [$plan->problems, null];
        }

        $where = "entry '{$plan->entryId}'";
        $other = array_values(array_filter($plan->writerRefusals, static fn (WriterRefusal $refusal): bool => !in_array($refusal->code, self::HAND_EDIT_CODES, true)));
        if ($other !== []) {
            return [array_map(static fn (WriterRefusal $refusal): ConfigProblem => RunProblems::ofWriter($refusal, $where), $other), null];
        }

        if ($plan->writerRefusals !== []) {
            $items = array_map(static fn (WriterRefusal $refusal): string => rtrim($refusal->message, '.'), $plan->writerRefusals);

            return [[], self::driftProblem($plan->entryId, $items, $plan->writerRefusals[0]->fix)];
        }

        $write = $plan->write;
        if ($write === null) {
            return [[], null];
        }

        $items = [
            ...array_map(static fn (string $path): string => file_exists("{$write->rootDir}/{$path}") ? "{$path} (differs)" : "{$path} (missing)", $write->changed()),
            ...array_map(static fn (string $path): string => "{$path} (stale: generated earlier, no longer produced)", $write->removable),
        ];

        return [[], $items === [] ? null : self::driftProblem($plan->entryId, $items, self::GENERATE_FIX)];
    }

    /** @param list<string> $items */
    private static function driftProblem(string $entryId, array $items, string $fix): ConfigProblem
    {
        return new ConfigProblem(
            'check.generated.drift',
            "The generated files of entry '{$entryId}' differ from the files on disk: " . implode('; ', $items) . '.',
            $fix,
            "entry '{$entryId}'",
        );
    }

    /** @return list<string> */
    private static function leftEntries(AppConfig $config): array
    {
        return array_map(
            static fn (AppConfigEntry $other): string => "seampact: entry '{$other->id()}' uses '{$other->use()}', which its own runner generates; vendor/bin/seampact leaves it.",
            $config->otherEntries,
        );
    }
}
