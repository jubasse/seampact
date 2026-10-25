<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests\Shape;

/** The shape manifest every hooks package shares, read from `fixtures/hooks-shape/shape.json`. */
final class ShapeManifest
{
    private const PHP_LANGUAGE = 'php';

    private function __construct()
    {
    }

    /** @param list<string> $languages */
    public static function languagesIncludePhp(array $languages): bool
    {
        return $languages === [] || in_array(self::PHP_LANGUAGE, $languages, true);
    }

    /** @return list<ManifestType> */
    public static function read(string $path): array
    {
        $text = file_get_contents($path);

        if ($text === false) {
            throw new \RuntimeException("The shape manifest {$path} cannot be read.");
        }

        $root = self::object(json_decode($text, true, flags: JSON_THROW_ON_ERROR), $path);

        return array_map(
            static fn (mixed $entry): ManifestType => self::readType(self::object($entry, $path)),
            self::list($root, 'types'),
        );
    }

    /** @param array<string, mixed> $object */
    private static function readType(array $object): ManifestType
    {
        return new ManifestType(
            self::text($object, 'name'),
            self::text($object, 'kind'),
            self::strings($object, 'languages'),
            self::members($object),
            array_map(
                static fn (mixed $entry): ManifestArm => self::readArm(self::object($entry, 'arm')),
                self::list($object, 'arms'),
            ),
            array_map(
                static fn (mixed $entry): ManifestMethod => self::readMethod(self::object($entry, 'method')),
                self::list($object, 'methods'),
            ),
            self::strings($object, 'values'),
        );
    }

    /**
     * @param array<string, mixed> $object
     *
     * @return list<ManifestMember>
     */
    private static function members(array $object): array
    {
        return array_map(
            static fn (mixed $entry): ManifestMember => self::readMember(self::object($entry, 'member')),
            self::list($object, 'members'),
        );
    }

    /** @param array<string, mixed> $object */
    private static function readMember(array $object): ManifestMember
    {
        return new ManifestMember(
            self::text($object, 'name'),
            self::flag($object, 'optional'),
            self::flag($object, 'nullable'),
            self::optionalText($object, 'enum'),
            self::strings($object, 'languages'),
        );
    }

    /** @param array<string, mixed> $object */
    private static function readArm(array $object): ManifestArm
    {
        return new ManifestArm(
            self::optionalText($object, 'name'),
            self::optionalText($object, 'type'),
            self::members($object),
        );
    }

    /** @param array<string, mixed> $object */
    private static function readMethod(array $object): ManifestMethod
    {
        return new ManifestMethod(
            self::text($object, 'name'),
            self::strings($object, 'parameters'),
            self::flag($object, 'static'),
            self::optionalText($object, 'returns'),
        );
    }

    /** @return array<string, mixed> */
    private static function object(mixed $value, string $where): array
    {
        if (!is_array($value) || array_is_list($value) && $value !== []) {
            throw new \UnexpectedValueException("The shape manifest has a non-object {$where}.");
        }

        $object = [];

        foreach ($value as $key => $member) {
            $object[(string) $key] = $member;
        }

        return $object;
    }

    /**
     * @param array<string, mixed> $object
     *
     * @return list<mixed>
     */
    private static function list(array $object, string $key): array
    {
        $value = $object[$key] ?? [];

        if (!is_array($value) || !array_is_list($value)) {
            throw new \UnexpectedValueException("The shape manifest entry \"{$key}\" must be an array.");
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $object
     *
     * @return list<string>
     */
    private static function strings(array $object, string $key): array
    {
        return array_map(
            static fn (mixed $entry): string => is_string($entry)
                ? $entry
                : throw new \UnexpectedValueException("The shape manifest entry \"{$key}\" must hold strings."),
            self::list($object, $key),
        );
    }

    /** @param array<string, mixed> $object */
    private static function text(array $object, string $key): string
    {
        return self::optionalText($object, $key)
            ?? throw new \UnexpectedValueException("The shape manifest entry has no \"{$key}\".");
    }

    /** @param array<string, mixed> $object */
    private static function optionalText(array $object, string $key): ?string
    {
        $value = $object[$key] ?? null;

        if ($value !== null && !is_string($value)) {
            throw new \UnexpectedValueException("The shape manifest entry \"{$key}\" must be a string.");
        }

        return $value;
    }

    /** @param array<string, mixed> $object */
    private static function flag(array $object, string $key): bool
    {
        $value = $object[$key] ?? false;

        if (!is_bool($value)) {
            throw new \UnexpectedValueException("The shape manifest entry \"{$key}\" must be true or false.");
        }

        return $value;
    }
}
