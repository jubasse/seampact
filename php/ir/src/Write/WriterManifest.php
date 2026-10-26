<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/**
 * What the writer keeps in a target's output directory (ADR 0015 "Writing files"), as `manifest.ts`: the target that
 * owns the directory, and each file it generated with the SHA-256 of its bytes, in code-unit order of path. The
 * Node writer, the JVM writer and this one read and write the same file.
 */
final readonly class WriterManifest
{
    public const FILE_NAME = '.seampact-manifest.json';

    private const SHA256_HEX = '/^[0-9a-f]{64}$/D';

    /** @param array<string, string> $hashByPath */
    private function __construct(public ?string $owner, public array $hashByPath)
    {
    }

    /** The manifest of `$rootDir`, or why it cannot be read; a missing one is empty, with no owner (a first run). */
    public static function read(string $rootDir): self|string
    {
        $file = $rootDir . '/' . self::FILE_NAME;
        if (!file_exists($file)) {
            return new self(null, []);
        }

        $text = file_get_contents($file);
        if ($text === false) {
            return 'it cannot be read';
        }

        try {
            $parsed = json_decode($text, false, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            return "it is not JSON ({$error->getMessage()})";
        }

        $files = $parsed instanceof \stdClass ? $parsed->files ?? null : null;
        if (!is_array($files)) {
            return 'it has no `files` array';
        }

        $owner = $parsed->owner ?? null;
        if (!is_string($owner)) {
            return 'it has no `owner` target id';
        }

        return self::entries($owner, $files);
    }

    /** @param array<mixed> $files */
    private static function entries(string $owner, array $files): self|string
    {
        $hashByPath = [];

        foreach ($files as $entry) {
            $path = $entry instanceof \stdClass ? $entry->path ?? null : null;
            $sha256 = $entry instanceof \stdClass ? $entry->sha256 ?? null : null;
            if (!is_string($path) || !is_string($sha256)) {
                return 'an entry is not `{ path, sha256 }` strings';
            }
            if (preg_match(self::SHA256_HEX, $sha256) !== 1) {
                return "the hash of '{$path}' is not a SHA-256 hex digest";
            }
            if (array_key_exists($path, $hashByPath)) {
                return "'{$path}' is listed twice";
            }

            $unsafe = GeneratedPaths::unsafeReason($path);
            if ($unsafe !== null) {
                return "the path '{$path}' is unsafe: {$unsafe}";
            }
            $hashByPath[$path] = $sha256;
        }

        return new self($owner, $hashByPath);
    }

    /**
     * The manifest's text, byte for byte the Node writer's `JSON.stringify(..., null, 2)` and a final newline.
     *
     * @param array<string, string> $hashByPath
     */
    public static function serialized(string $owner, array $hashByPath): string
    {
        ksort($hashByPath, SORT_STRING);
        $entries = [];
        foreach ($hashByPath as $path => $sha256) {
            $entries[] = "    {\n      \"path\": " . self::jsonString((string) $path) . ",\n      \"sha256\": " . self::jsonString($sha256) . "\n    }";
        }
        $filesBlock = $entries === [] ? '[]' : "[\n" . implode(",\n", $entries) . "\n  ]";

        return "{\n  \"owner\": " . self::jsonString($owner) . ",\n  \"files\": {$filesBlock}\n}\n";
    }

    private static function jsonString(string $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }
}
