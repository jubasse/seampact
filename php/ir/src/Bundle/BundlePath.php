<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The portable-path rule of a bundle file (`schemas/bundle/README.md`, "Paths"): relative to the bundle root,
 * under `sources/` or `ir/`, each segment of `[A-Za-z0-9._@+-]`, not ending in `.` and not a Windows device name
 * before its first `.`. The named checks say what is wrong; the schema's `$defs/path` patterns stay the one source.
 */
final class BundlePath
{
    private const TOP_DIRECTORIES = [BundleLayout::SOURCES_DIRECTORY, BundleLayout::IR_DIRECTORY];

    private const UNPORTABLE_CHARACTER = '/[^A-Za-z0-9._@+-]/';

    private const DEVICE_STEM = '/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/D';

    private function __construct()
    {
    }

    /** Why `$path` is not a portable bundle path, or null when it is one. */
    public static function problem(string $path): ?string
    {
        $definition = self::pathDefinition();
        $maxLength = $definition->maxLength;

        if (strlen($path) > $maxLength) {
            return "is longer than {$maxLength} characters";
        }

        $segments = explode('/', $path);
        if (!in_array($segments[0], self::TOP_DIRECTORIES, true) || count($segments) < 2) {
            return 'is not a file under sources/ or ir/';
        }

        foreach ($segments as $segment) {
            $problem = self::segmentProblem($segment);
            if ($problem !== null) {
                return $problem;
            }
        }

        if (!self::matches($definition->pattern, $path) || self::matches($definition->devicePattern, $path)) {
            return 'does not match the portable path pattern';
        }

        return null;
    }

    /** The key two paths share when they differ only in ASCII letter case (a case-insensitive file system). */
    public static function fold(string $path): string
    {
        return strtr($path, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
    }

    private static function segmentProblem(string $segment): ?string
    {
        if ($segment === '' || $segment === '.' || $segment === '..') {
            return "has an empty, '.' or '..' segment";
        }

        if (preg_match(self::UNPORTABLE_CHARACTER, $segment, $match) === 1) {
            return 'holds ' . self::shownCharacter($segment, $match[0]) . ', outside the portable characters A-Z a-z 0-9 . _ @ + -';
        }

        if (str_ends_with($segment, '.')) {
            return "has the segment '{$segment}', ending in '.' (Windows drops it)";
        }

        $stem = explode('.', $segment)[0];
        if (preg_match(self::DEVICE_STEM, self::fold($stem)) === 1) {
            return "has the segment '{$segment}', a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9)";
        }

        return null;
    }

    // The first unportable character as U+XXXX; a byte that is not UTF-8 as itself.
    private static function shownCharacter(string $segment, string $firstByte): string
    {
        if (!BundleText::isUtf8($segment)) {
            return sprintf('the byte 0x%02X', ord($firstByte));
        }

        $offset = strpos($segment, $firstByte);
        $rest = substr($segment, $offset === false ? 0 : $offset);
        $character = preg_match('/^./su', $rest, $match) === 1 ? $match[0] : $firstByte;
        $encoded = json_encode($character, JSON_THROW_ON_ERROR);

        return preg_match('/^"\\\\u([0-9a-f]{4})"$/', $encoded, $hex) === 1
            ? 'U+' . strtoupper($hex[1])
            : sprintf('U+%04X', ord($character));
    }

    private static function matches(string $pattern, string $value): bool
    {
        return preg_match("\x07{$pattern}\x07uD", $value) === 1;
    }

    /** @return object{pattern: string, devicePattern: string, maxLength: int} */
    private static function pathDefinition(): object
    {
        $definitions = SpecSchema::manifestDocument()->{'$defs'} ?? null;
        $path = $definitions instanceof \stdClass ? $definitions->path ?? null : null;
        $pattern = $path instanceof \stdClass ? $path->pattern ?? null : null;
        $not = $path instanceof \stdClass ? $path->not ?? null : null;
        $devicePattern = $not instanceof \stdClass ? $not->pattern ?? null : null;
        $maxLength = $path instanceof \stdClass ? $path->maxLength ?? null : null;

        if (!is_string($pattern) || !is_string($devicePattern) || !is_int($maxLength)) {
            throw new \LogicException('seampact/ir: the manifest schema has no readable $defs/path; reinstall seampact/ir.');
        }

        return (object) ['pattern' => $pattern, 'devicePattern' => $devicePattern, 'maxLength' => $maxLength];
    }
}
