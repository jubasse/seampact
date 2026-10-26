<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The manifest rules no JSON Schema states (`schemas/bundle/README.md`, "Manifest rules"), checked after the
 * schema: files strictly sorted by path in code-unit order, so no path is listed twice; no two paths equal once
 * folded to ASCII lower case; each api named once, its file `ir/<name>.json` and listed; every `ir/` file an
 * api's; packs sorted by name then version, none twice. The schema keeps every name ASCII, so byte order is
 * code-unit order. Each problem reads `at '<pointer>' <problem>`.
 */
final class BundleManifestRules
{
    private function __construct()
    {
    }

    /** @return list<string> every rule a schema-valid manifest breaks, in manifest order */
    public static function problems(BundleManifest $manifest): array
    {
        return [...self::fileProblems($manifest), ...self::apiProblems($manifest), ...self::packProblems($manifest)];
    }

    private static function at(string $pointer, string $message): string
    {
        return 'at ' . BundleText::quoted($pointer) . ' ' . $message;
    }

    /** @return list<string> */
    private static function fileProblems(BundleManifest $manifest): array
    {
        $problems = [];
        $pathByFold = [];

        foreach ($manifest->files as $index => $file) {
            $pointer = "/files/{$index}/path";
            $previous = $index > 0 ? $manifest->files[$index - 1]->path : null;

            if ($previous === $file->path) {
                $problems[] = self::at($pointer, "'{$file->path}' is listed twice");
            } elseif ($previous !== null && strcmp($previous, $file->path) > 0) {
                $problems[] = self::at($pointer, "'{$file->path}' is listed after '{$previous}'; sort the files by path");
            }

            $folded = BundlePath::fold($file->path);
            $sameFold = $pathByFold[$folded] ?? null;
            if ($sameFold !== null && $sameFold !== $file->path) {
                $problems[] = self::at($pointer, "'{$file->path}' differs from '{$sameFold}' only in letter case");
            }
            $pathByFold[$folded] = $file->path;
        }

        return $problems;
    }

    /** @return list<string> */
    private static function apiProblems(BundleManifest $manifest): array
    {
        $problems = [];
        $listed = array_flip(array_map(static fn (BundleFile $file): string => $file->path, $manifest->files));
        $apiFiles = [];
        $names = [];

        foreach ($manifest->apis as $index => $api) {
            $expectedFile = BundleLayout::IR_DIRECTORY . "/{$api->name}.json";

            if (isset($names[$api->name])) {
                $problems[] = self::at("/apis/{$index}/name", "the api '{$api->name}' is listed twice");
            }

            if ($api->file !== $expectedFile) {
                $problems[] = self::at("/apis/{$index}/file", "the file of api '{$api->name}' is '{$api->file}', not '{$expectedFile}'");
            } elseif (!isset($listed[$api->file])) {
                $problems[] = self::at("/apis/{$index}/file", "'{$api->file}' is not in files");
            }

            $names[$api->name] = true;
            $apiFiles[$api->file] = true;
        }

        foreach ($manifest->files as $index => $file) {
            if (str_starts_with($file->path, BundleLayout::IR_DIRECTORY . '/') && !isset($apiFiles[$file->path])) {
                $problems[] = self::at("/files/{$index}/path", "'{$file->path}' is not the file of any api");
            }
        }

        return $problems;
    }

    /** @return list<string> */
    private static function packProblems(BundleManifest $manifest): array
    {
        $problems = [];

        foreach ($manifest->packs as $index => $pack) {
            if ($index === 0) {
                continue;
            }

            $previous = $manifest->packs[$index - 1];
            $nameOrder = strcmp($previous->name, $pack->name);
            $order = $nameOrder !== 0 ? $nameOrder : strcmp($previous->version, $pack->version);

            if ($order >= 0) {
                $problems[] = self::at(
                    "/packs/{$index}",
                    "the pack '{$pack->name}@{$pack->version}' is listed twice or out of order; sort the packs by name then version",
                );
            }
        }

        return $problems;
    }
}
