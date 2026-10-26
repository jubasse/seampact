<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The packages Composer installed, by name, from `vendor/composer/installed.json` in the Composer 2 shape
 * (`{ "packages": [...] }`): the one reader of that file. A missing file lists no package; a file of another
 * shape, or a package with no name, is refused with the reason, which each caller names with its own code.
 */
final readonly class InstalledPackages
{
    public const INSTALLED_FILE = '/composer/installed.json';

    /** @param array<string, \stdClass> $byName */
    private function __construct(public string $file, public array $byName)
    {
    }

    /** @return self|string the packages, or why the file does not read */
    public static function read(string $vendorDirectory): self|string
    {
        $file = $vendorDirectory . self::INSTALLED_FILE;
        if (!is_file($file)) {
            return new self($file, []);
        }

        $text = @file_get_contents($file);
        if ($text === false) {
            return "the list of installed packages {$file} cannot be read";
        }

        try {
            $installed = json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            return "the list of installed packages {$file} is not readable JSON ({$error->getMessage()})";
        }

        $packages = $installed instanceof \stdClass ? $installed->packages ?? null : null;
        if (!is_array($packages)) {
            return "the list of installed packages {$file} is not a JSON object with a `packages` list, the shape Composer 2 writes";
        }

        $byName = [];
        foreach ($packages as $index => $package) {
            if (!$package instanceof \stdClass || !is_string($package->name ?? null)) {
                return "the package at index {$index} of {$file} is not an object with a name";
            }
            $byName[$package->name] = $package;
        }

        return new self($file, $byName);
    }
}
