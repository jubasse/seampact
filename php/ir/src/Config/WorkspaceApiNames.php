<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/**
 * The api names a `path` source holds, read without compiling it, as the Node CLI's `workspace-api-names.ts`: the
 * `workspace.apis` of its `workspace.yaml`, or the `api.name` of its single api file. Null when the file cannot be
 * read or parsed, or does not name them: the source is then compiled, and the compiler says what is wrong with it.
 */
final class WorkspaceApiNames
{
    private const WORKSPACE_ENTRY = 'workspace.yaml';

    // A workspace with a single api may omit `workspace.yaml` (grammar section 1): its api file is then this one.
    private const SINGLE_API_ENTRY = 'api.yaml';

    private function __construct()
    {
    }

    /** @return ?list<string> */
    public static function of(string $directory): ?array
    {
        foreach ([self::WORKSPACE_ENTRY, self::SINGLE_API_ENTRY] as $entryName) {
            $entry = $directory . '/' . $entryName;
            if (!file_exists($entry)) {
                continue;
            }

            $size = filesize($entry);
            if ($size === false || $size > ConfigYaml::MAX_CONFIG_BYTES) {
                return null;
            }

            $text = @file_get_contents($entry);
            $tree = $text === false ? [] : ConfigYaml::parseText($text, $entry);
            if (!$tree instanceof ConfigTree) {
                return null;
            }

            return $entryName === self::SINGLE_API_ENTRY ? self::singleApiName($tree->value) : self::workspaceApis($tree->value);
        }

        return null;
    }

    /** @return ?list<string> */
    private static function singleApiName(mixed $value): ?array
    {
        $name = JsonValue::string(JsonValue::object($value, 'api'), 'name');

        return $name === null ? null : [$name];
    }

    /** @return ?list<string> */
    private static function workspaceApis(mixed $value): ?array
    {
        $apis = JsonValue::object(JsonValue::object($value, 'workspace'), 'apis');

        return $apis === null ? null : array_map(strval(...), array_keys(get_object_vars($apis)));
    }
}
