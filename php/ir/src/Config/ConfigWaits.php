<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * The keys and value forms of ADR 0011 the PHP runner does not read yet, each with the work that brings it, as the
 * Node CLI's `config-waits.ts`: each is refused by name (`config.key.waits`), never ignored. A target entry of
 * another ecosystem is not a wait here: the PHP runner leaves it to its own runner.
 */
final class ConfigWaits
{
    private const SERVER_ENTRY_BRINGER = 'the boundary runtime of the PHP server targets';

    // A module link only arises across the apps of a monorepo, and no app links across apps yet.
    private const MODULE_LINK_BRINGER = 'links across the apps of a monorepo, once an app needs one';

    private const ENTRY_KEY_WAITS = ['access'];

    // The handler check of the boot check comes with the access hooks (ADR 0012).
    private const BOOT_CHECK_HANDLERS = 'handlers';

    private function __construct()
    {
    }

    /**
     * Every waiting key of `$config`, the parsed value not yet schema-checked, as `config.key.waits`.
     *
     * @return list<KeyProblem>
     */
    public static function problems(ConfigTree $tree): array
    {
        $targets = JsonValue::list($tree->value, 'targets') ?? [];
        $problems = [];

        foreach ($targets as $index => $entry) {
            foreach (self::entryWaits($entry, ['targets', $index]) as [$path, $what, $bringer]) {
                $problems[] = new KeyProblem($path, new ConfigProblem(
                    'config.key.waits',
                    ucfirst($what) . " is not available yet; it comes with {$bringer}.",
                    'Remove it from the config for now.',
                    $tree->whereOf($path),
                ));
            }
        }

        return $problems;
    }

    /**
     * @param list<string|int> $path
     * @return list<array{list<string|int>, string, string}>
     */
    private static function entryWaits(mixed $entry, array $path): array
    {
        if (!$entry instanceof \stdClass) {
            return [];
        }

        $waits = [];
        foreach (self::ENTRY_KEY_WAITS as $key) {
            if (property_exists($entry, $key)) {
                $waits[] = [[...$path, $key], "the key '{$key}'", self::SERVER_ENTRY_BRINGER];
            }
        }

        $bootCheck = JsonValue::object(JsonValue::object($entry, 'artefacts'), 'bootCheck');
        if ($bootCheck !== null && property_exists($bootCheck, self::BOOT_CHECK_HANDLERS)) {
            $waits[] = [
                [...$path, 'artefacts', 'bootCheck', self::BOOT_CHECK_HANDLERS],
                "the boot check switch '" . self::BOOT_CHECK_HANDLERS . "'",
                self::SERVER_ENTRY_BRINGER,
            ];
        }

        foreach (get_object_vars(JsonValue::object($entry, 'link') ?? new \stdClass()) as $kind => $provider) {
            if ($provider instanceof \stdClass) {
                $waits[] = [[...$path, 'link', (string) $kind], 'a link with an explicit module specifier', self::MODULE_LINK_BRINGER];
            }
        }

        return $waits;
    }
}
