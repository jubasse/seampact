<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\AppConfigEntry;
use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Config\JsonValue;

/**
 * The compatibility check of the PHP entries (ADR 0011 "The app config", ADR 0009), as the Node CLI and the JVM
 * plugins run it and with their codes: the framework version Composer installed is checked against the `phpTargets`
 * of `@seampact/spec`'s `compatibility/matrix.json`, of which `resources/compatibility/` holds a copy. A target the
 * matrix does not record is not checked.
 */
final class MatrixCheck
{
    private const MATRIX_FILE = __DIR__ . '/../../resources/compatibility/matrix.json';

    private const ERROR_LEVEL = 'error';

    private function __construct()
    {
    }

    /**
     * @param array<string, \stdClass> $installed the packages Composer installed, by name
     * @return array{list<ConfigProblem>, list<ConfigProblem>} the problems that refuse the run, and the warnings
     */
    public static function check(AppConfig $config, array $installed): array
    {
        return self::checkAgainst($config, $installed, self::frameworks());
    }

    /**
     * The check against `$frameworks`, the PHP targets of a matrix by their `use` package.
     *
     * @param array<string, \stdClass> $installed
     * @param array<string, MatrixFramework> $frameworks
     * @return array{list<ConfigProblem>, list<ConfigProblem>}
     */
    public static function checkAgainst(AppConfig $config, array $installed, array $frameworks): array
    {
        $untestedIsError = JsonValue::string($config->checks, 'matrix') === self::ERROR_LEVEL;
        $problems = [];
        $warnings = [];

        foreach ($config->entries as $entry) {
            $framework = $frameworks[$entry->use()] ?? null;
            if ($framework === null) {
                continue;
            }

            $allowed = JsonValue::strings($entry->entry, 'allowUntested') ?? [];
            foreach ($allowed as $item) {
                if (self::frameworkIdOf($item) !== $framework->id) {
                    $problems[] = self::foreignFramework($entry, $item, $framework);
                } elseif (in_array($item, $framework->testedItems(), true)) {
                    $warnings[] = self::allowedTested($entry, $item);
                }
            }

            $outcome = self::versionOutcome($entry, $framework, $installed[$framework->package] ?? null, $allowed);
            if ($outcome === null) {
                continue;
            }

            if ($outcome->code === 'config.matrix.untested' && !$untestedIsError) {
                $warnings[] = $outcome;
            } else {
                $problems[] = $outcome;
            }
        }

        return [$problems, $warnings];
    }

    /** @param list<string> $allowed */
    private static function versionOutcome(AppConfigEntry $entry, MatrixFramework $framework, ?\stdClass $package, array $allowed): ?ConfigProblem
    {
        $version = $package === null ? null : self::installedVersion($package);
        if ($version === null) {
            return new ConfigProblem(
                'framework.version.unresolved',
                "Composer has not installed {$framework->package}, the framework the target '{$entry->use()}' generates for, so its version cannot be checked.",
                "Require {$framework->package} in the app, major {$framework->testedText()}, then run `composer install`.",
                self::where($entry),
            );
        }

        $parts = preg_match('/^(\d+)\.(\d+)/', $version, $match) === 1 ? [(int) $match[1], (int) $match[2]] : null;
        if ($parts === null) {
            return new ConfigProblem(
                'framework.version.unresolved',
                "Composer installed {$framework->package} '{$version}', a version whose major the compatibility check cannot read.",
                "Require a released {$framework->package} version, major {$framework->testedText()}.",
                self::where($entry),
            );
        }

        [$major, $minor] = $parts;
        if ($framework->isBelowFloor($major, $minor)) {
            return new ConfigProblem(
                'config.matrix.incompatible',
                "Composer installed {$framework->package} {$version}, and the target '{$entry->use()}' works on {$framework->id} {$framework->floor} or later only.",
                "Require {$framework->package} {$framework->floor} or later, major {$framework->testedText()}.",
                self::where($entry),
            );
        }

        $incompatibleReason = $framework->incompatible[$major] ?? null;
        if ($incompatibleReason !== null) {
            return new ConfigProblem(
                'config.matrix.incompatible',
                "Composer installed {$framework->package} {$version}, and the target '{$entry->use()}' does not work on {$framework->id} {$major}: {$incompatibleReason}",
                "Use a major of {$framework->package} the target is tested on: {$framework->testedText()}.",
                self::where($entry),
            );
        }

        $allowItem = "{$framework->id}@{$major}";
        if (in_array($major, $framework->testedMajors, true) || in_array($allowItem, $allowed, true)) {
            return null;
        }

        return new ConfigProblem(
            'config.matrix.untested',
            "Composer installed {$framework->package} {$version}, and the target '{$entry->use()}' is tested on {$framework->id} {$framework->testedText()} only.",
            "Use a tested major, or accept this one with `allowUntested: [{$allowItem}]` on the entry.",
            self::where($entry),
        );
    }

    // Composer writes `version_normalized` (13.38.2.0) beside the tag (`v13.38.2`); a branch is `dev-<name>`.
    private static function installedVersion(\stdClass $package): ?string
    {
        $normalized = $package->version_normalized ?? null;
        if (is_string($normalized) && $normalized !== '') {
            return $normalized;
        }

        $version = $package->version ?? null;

        return is_string($version) ? ltrim($version, 'v') : null;
    }

    /** @return array<string, MatrixFramework> the framework of each PHP target of the matrix, by its `use` package */
    private static function frameworks(): array
    {
        $text = file_get_contents(self::MATRIX_FILE);
        if ($text === false) {
            throw new \LogicException('seampact/ir ships no resources/compatibility/matrix.json; reinstall the package.');
        }

        $matrix = json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        $targets = $matrix instanceof \stdClass ? $matrix->phpTargets ?? null : null;
        if (!is_array($targets)) {
            throw new \LogicException('resources/compatibility/matrix.json has no phpTargets list; reinstall seampact/ir.');
        }

        $frameworks = [];
        foreach ($targets as $target) {
            $read = MatrixFramework::of($target);
            $frameworks[$read[0]] = $read[1];
        }

        return $frameworks;
    }

    // `<framework>@<major>`, as the app config schema checked it.
    private static function frameworkIdOf(string $item): string
    {
        $at = strrpos($item, '@');

        return $at === false ? $item : substr($item, 0, $at);
    }

    private static function where(AppConfigEntry $entry): string
    {
        return "entry '{$entry->id()}'";
    }

    private static function foreignFramework(AppConfigEntry $entry, string $item, MatrixFramework $framework): ConfigProblem
    {
        return new ConfigProblem(
            'config.matrix.unknown-framework',
            "The `allowUntested` item '{$item}' names the framework '" . self::frameworkIdOf($item) . "', and the target '{$entry->use()}' serves '{$framework->id}'.",
            "Write the item as '{$framework->id}@<major>', or remove it.",
            self::where($entry) . ' allowUntested',
        );
    }

    private static function allowedTested(AppConfigEntry $entry, string $item): ConfigProblem
    {
        return new ConfigProblem(
            'config.matrix.allowed-tested',
            "The `allowUntested` item '{$item}' names a major the compatibility matrix tests the target '{$entry->use()}' on, so it accepts nothing.",
            "Remove '{$item}' from the entry's `allowUntested`.",
            self::where($entry) . ' allowUntested',
        );
    }
}
