<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

use Seampact\Ir\Binary\AbsolutePath;
use Seampact\Ir\Bundle\BundleSource;
use Seampact\Ir\Bundle\GitSource;
use Seampact\Ir\Bundle\RegistrySource;
use Seampact\Ir\Bundle\ReleaseSource;

/**
 * Reads an app config (ADR 0011 "The app config") as the Node CLI's `read-app-config.ts` does, with the same
 * problem codes: YAML, then the waiting keys, then `app.schema.json`, then the rules the schema cannot state. A
 * monorepo root config that lists the app is refused by name (`config.root.unsupported`), as on the JVM. Paths
 * resolve against the config's directory.
 */
final class AppConfigReader
{
    public const FILE_NAME = 'seampact.config.yaml';

    private const ROOT_CONFIG_MARKER_KEY = 'apps';

    private const DEFAULT_OUT_DIR = '__generated__';

    // The directory that ends the search for a root config: a repository's top, the first one holding `.git`.
    private const REPOSITORY_MARKER = '.git';

    private function __construct()
    {
    }

    /** @return AppConfig|list<ConfigProblem> */
    public static function readFile(string $file, ?string $displayName = null): AppConfig|array
    {
        $absolute = ConfigPath::normalize(AbsolutePath::resolved($file));
        $tree = ConfigYaml::readFile($absolute, $displayName ?? $file, ConfigKind::App);
        if (is_array($tree)) {
            return $tree;
        }

        if (JsonValue::has($tree->value, self::ROOT_CONFIG_MARKER_KEY)) {
            return [new ConfigProblem(
                'config.root.not-an-app',
                'This file is a monorepo root config (it holds `' . self::ROOT_CONFIG_MARKER_KEY . '`), and the command runs on one app\'s config.',
                'Run the command in one of the apps the root config lists, or pass that app\'s config with `--config`.',
                $tree->whereOf([self::ROOT_CONFIG_MARKER_KEY]),
            )];
        }

        $problems = ConfigSchemaCheck::problems($tree, ConfigKind::App, ConfigWaits::problems($tree));
        if ($problems !== []) {
            return $problems;
        }

        $directory = dirname($absolute);
        $rootProblems = self::listingRootProblems($directory);
        if ($rootProblems !== []) {
            return $rootProblems;
        }

        $config = $tree->value;
        if (!$config instanceof \stdClass) {
            throw new \LogicException('seampact: a value the app schema accepts is an object.');
        }

        return self::resolved($tree, $absolute, $config);
    }

    /** @return AppConfig|list<ConfigProblem> */
    private static function resolved(ConfigTree $tree, string $file, \stdClass $config): AppConfig|array
    {
        $directory = dirname($file);
        $outDir = ConfigPath::resolve($directory, JsonValue::string($config, 'outDir') ?? self::DEFAULT_OUT_DIR);
        $entries = [];

        foreach (JsonValue::list($config, 'targets') ?? [] as $entry) {
            if ($entry instanceof \stdClass) {
                $out = JsonValue::string($entry, 'out') ?? JsonValue::string($entry, 'id') ?? '';
                $copy = JsonValue::copy($entry);
                $entries[] = new AppConfigEntry($copy instanceof \stdClass ? $copy : new \stdClass(), ConfigPath::resolve($outDir, $out));
            }
        }

        $problems = [
            ...self::duplicateIdProblems($tree, $entries),
            ...self::outsideOutDirProblems($tree, $outDir, $entries),
            ...self::overlappingOutProblems($tree, $entries),
            ...self::switchedOffAllowListProblems($tree, $entries),
            ...self::frameworkDocsConflictProblems($tree, $entries),
        ];
        if ($problems !== []) {
            return $problems;
        }

        $sources = [];
        foreach (get_object_vars(JsonValue::object($config, 'sources') ?? new \stdClass()) as $name => $source) {
            if ($source instanceof \stdClass) {
                $sources[(string) $name] = self::sourceOf($directory, $source);
            }
        }

        $composerEntries = array_values(array_filter($entries, static fn (AppConfigEntry $entry): bool => $entry->ecosystem() === TargetEcosystem::Composer));
        $otherEntries = array_values(array_filter($entries, static fn (AppConfigEntry $entry): bool => $entry->ecosystem() !== TargetEcosystem::Composer));
        $checks = JsonValue::copy(JsonValue::object($config, 'checks'));
        $warnings = JsonValue::copy(JsonValue::object($config, 'warnings'));

        return new AppConfig(
            $tree->displayName,
            $file,
            $directory,
            $outDir,
            JsonValue::bool($config, 'allowLocal'),
            $sources,
            $composerEntries,
            $otherEntries,
            JsonValue::copy(JsonValue::member($config, 'openapi')),
            $checks instanceof \stdClass ? $checks : null,
            $warnings instanceof \stdClass ? $warnings : null,
        );
    }

    private static function sourceOf(string $directory, \stdClass $source): LocalSource|BundleSource
    {
        $path = JsonValue::string($source, 'path');
        if ($path !== null) {
            return new LocalSource(ConfigPath::resolve($directory, $path));
        }

        $integrity = JsonValue::string($source, 'integrity');
        $release = JsonValue::object($source, 'release');
        $git = JsonValue::object($source, 'git');
        $maven = JsonValue::string($source, 'maven');

        return match (true) {
            $release !== null => new ReleaseSource(JsonValue::string($release, 'url') ?? '', $integrity),
            $git !== null => new GitSource(JsonValue::string($git, 'url') ?? '', JsonValue::string($git, 'tag') ?? '', JsonValue::string($git, 'directory'), $integrity),
            $maven !== null => new RegistrySource(RegistrySource::MAVEN, $maven, $integrity),
            default => new RegistrySource(
                RegistrySource::NPM,
                (JsonValue::string($source, 'package') ?? '') . '@' . (JsonValue::string($source, 'version') ?? ''),
                $integrity,
            ),
        };
    }

    /**
     * @param list<AppConfigEntry> $entries
     * @return list<ConfigProblem>
     */
    private static function duplicateIdProblems(ConfigTree $tree, array $entries): array
    {
        $problems = [];
        $seen = [];

        foreach ($entries as $index => $entry) {
            if (isset($seen[$entry->id()])) {
                $problems[] = new ConfigProblem(
                    'config.target.duplicate-id',
                    "Two target entries have the id '{$entry->id()}'.",
                    'Give each target entry its own id.',
                    $tree->whereOf(['targets', $index, 'id']),
                );
            }
            $seen[$entry->id()] = true;
        }

        return $problems;
    }

    /**
     * @param list<AppConfigEntry> $entries
     * @return list<ConfigProblem>
     */
    private static function outsideOutDirProblems(ConfigTree $tree, string $outDir, array $entries): array
    {
        $problems = [];

        foreach ($entries as $index => $entry) {
            if ($entry->root === $outDir || !ConfigPath::isAtOrBelow($entry->root, $outDir)) {
                $problems[] = new ConfigProblem(
                    'config.out.outside',
                    "The output directory of '{$entry->id()}' is not inside `outDir` ({$outDir}).",
                    'Give `out` a relative path that stays inside `outDir`.',
                    $tree->whereOf(['targets', $index, 'out']),
                );
            }
        }

        return $problems;
    }

    // Two entries writing to the same directory, or one inside the other, would remove each other's files.
    /**
     * @param list<AppConfigEntry> $entries
     * @return list<ConfigProblem>
     */
    private static function overlappingOutProblems(ConfigTree $tree, array $entries): array
    {
        $problems = [];

        foreach ($entries as $index => $entry) {
            foreach (array_slice($entries, $index + 1) as $other) {
                if (ConfigPath::isAtOrBelow($entry->root, $other->root) || ConfigPath::isAtOrBelow($other->root, $entry->root)) {
                    $problems[] = new ConfigProblem(
                        'config.out.overlap',
                        "The entries '{$entry->id()}' and '{$other->id()}' write to the same directory, or one inside the other.",
                        'Give each entry its own `out` directory, side by side under `outDir`.',
                        $tree->whereOf(['targets', $index]),
                    );
                }
            }
        }

        return $problems;
    }

    // An allow-list of a check switched off would be dropped without a word.
    /**
     * @param list<AppConfigEntry> $entries
     * @return list<ConfigProblem>
     */
    private static function switchedOffAllowListProblems(ConfigTree $tree, array $entries): array
    {
        $problems = [];

        foreach ($entries as $index => $entry) {
            $switch = self::frameworkRouteSwitchOff($entry->artefacts());
            if ($switch !== null && JsonValue::has($entry->entry, 'frameworkRoutes')) {
                $problems[] = new ConfigProblem(
                    'config.key.conflict',
                    "The entry '{$entry->id()}' allow-lists framework routes in 'frameworkRoutes' but switches their check off with '{$switch}: false'.",
                    "Keep one: remove 'frameworkRoutes' to leave the check off, or remove the switch to check the routes against the allow-list.",
                    $tree->whereOf(['targets', $index, 'frameworkRoutes']),
                );
            }
        }

        return $problems;
    }

    private static function frameworkRouteSwitchOff(\stdClass $artefacts): ?string
    {
        if (JsonValue::bool($artefacts, 'bootCheck') === false) {
            return 'artefacts.bootCheck';
        }

        $bootCheck = JsonValue::object($artefacts, 'bootCheck');

        return $bootCheck !== null && JsonValue::bool($bootCheck, 'frameworkRoutes') === false ? 'artefacts.bootCheck.frameworkRoutes' : null;
    }

    // `frameworkDocs: off` asks for no framework document while `nativeDocs` completes one.
    /**
     * @param list<AppConfigEntry> $entries
     * @return list<ConfigProblem>
     */
    private static function frameworkDocsConflictProblems(ConfigTree $tree, array $entries): array
    {
        $problems = [];

        foreach ($entries as $index => $entry) {
            if (JsonValue::string($entry->entry, 'frameworkDocs') === 'off' && JsonValue::bool($entry->artefacts(), 'nativeDocs') === true) {
                $problems[] = new ConfigProblem(
                    'config.key.conflict',
                    "The entry '{$entry->id()}' sets 'frameworkDocs: off' and 'artefacts.nativeDocs: true': one switches the framework's document off, the other completes it.",
                    "Keep one: remove 'frameworkDocs: off' to complete the framework's document, or switch 'artefacts.nativeDocs' off.",
                    $tree->whereOf(['targets', $index, 'frameworkDocs']),
                );
            }
        }

        return $problems;
    }

    /**
     * A monorepo root config that lists this app is refused by name: folding a root's sources into an app waits for
     * a PHP app that needs it. The search is the Node CLI's: each ancestor up to the first holding `.git`; a root
     * that does not list the app leaves it standing alone, and an ancestor config that does not read refuses it.
     *
     * @return list<ConfigProblem>
     */
    private static function listingRootProblems(string $appDirectory): array
    {
        if (file_exists($appDirectory . '/' . self::REPOSITORY_MARKER)) {
            return [];
        }

        $directory = dirname($appDirectory);
        $previous = $appDirectory;

        while ($directory !== $previous) {
            $candidate = $directory . '/' . self::FILE_NAME;
            if (file_exists($candidate)) {
                $problems = self::rootListingProblems($candidate, $appDirectory);
                if ($problems !== []) {
                    return $problems;
                }
            }

            if (file_exists($directory . '/' . self::REPOSITORY_MARKER)) {
                return [];
            }

            $previous = $directory;
            $directory = dirname($directory);
        }

        return [];
    }

    /** @return list<ConfigProblem> */
    private static function rootListingProblems(string $candidate, string $appDirectory): array
    {
        $tree = ConfigYaml::readFile($candidate, $candidate, ConfigKind::Root);
        if (is_array($tree)) {
            return $tree;
        }

        $apps = JsonValue::strings($tree->value, self::ROOT_CONFIG_MARKER_KEY);
        if ($apps === null) {
            return [];
        }

        $schemaProblems = ConfigSchemaCheck::problems($tree, ConfigKind::Root);
        if ($schemaProblems !== []) {
            return $schemaProblems;
        }

        foreach ($apps as $app) {
            if (ConfigPath::resolve(dirname($candidate), $app) === $appDirectory) {
                return [new ConfigProblem(
                    'config.root.unsupported',
                    "The monorepo root config {$candidate} lists this app ({$appDirectory}); a PHP build does not read a root config yet, it comes once a PHP app needs one.",
                    'Define the app\'s sources in its own config and remove the app from the root config\'s `apps`, or generate the app with the Node CLI.',
                    $tree->whereOf([self::ROOT_CONFIG_MARKER_KEY]),
                )];
            }
        }

        return [];
    }
}
