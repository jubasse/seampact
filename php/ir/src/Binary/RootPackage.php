<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The root package's `composer.json`: the file the `COMPOSER` variable names (relative to the project directory,
 * made absolute first),
 * else `composer.json` in the project directory. Only this file sets the binary override and the
 * `extra.seampact.phpPatched` opt-out; a dependency's `extra.seampact.binary`, which Composer copies into
 * `vendor/composer/installed.json`, is refused.
 */
final readonly class RootPackage
{
    private function __construct(public string $composerFile, private \stdClass $seampactExtra)
    {
    }

    /**
     * @param array<string, string> $environment
     * @throws BinaryRefusedException `binary.pin-invalid` when the file is unreadable or not a JSON object
     */
    public static function locate(string $projectDirectory, array $environment): self
    {
        $projectDirectory = AbsolutePath::resolved($projectDirectory);
        $named = $environment['COMPOSER'] ?? '';
        $composerFile = match (true) {
            $named === '' => $projectDirectory . DIRECTORY_SEPARATOR . 'composer.json',
            AbsolutePath::isAbsolute($named) => $named,
            default => $projectDirectory . DIRECTORY_SEPARATOR . $named,
        };

        $document = self::readJson($composerFile);
        $extra = $document->extra ?? null;
        $seampact = $extra instanceof \stdClass ? $extra->seampact ?? null : null;

        if ($seampact !== null && !$seampact instanceof \stdClass) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::PinInvalid,
                "`extra.seampact` of '{$composerFile}' is not an object.",
                'Make `extra.seampact` an object, such as {"binary": {"path": "...", "sha256": "..."}}, or remove it.',
            );
        }

        return new self($composerFile, $seampact ?? new \stdClass());
    }

    /** The `extra.seampact.binary` override, or null when the root package sets none. */
    public function binaryOverride(): ?BinaryOverride
    {
        if (!property_exists($this->seampactExtra, 'binary')) {
            return null;
        }

        return BinaryOverride::read($this->seampactExtra->binary, $this->composerFile);
    }

    /** Whether the root package says its PHP backports the fixes under an older version number. */
    public function phpPatched(): bool
    {
        $patched = $this->seampactExtra->phpPatched ?? false;

        if (!is_bool($patched)) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::PhpUnpatched,
                "`extra.seampact.phpPatched` of '{$this->composerFile}' is not true or false.",
                'Set `"phpPatched": true` only when your distribution backports the PHP fixes; otherwise remove it.',
            );
        }

        return $patched;
    }

    /**
     * Refuses an `extra.seampact.binary` set by any installed package (`binary.override-not-root`), so a
     * dependency never chooses the binary the build runs.
     */
    public static function refuseDependencyOverrides(string $vendorDirectory): void
    {
        $installedFile = $vendorDirectory . '/composer/installed.json';
        if (!is_file($installedFile)) {
            return;
        }

        $installed = self::readJson($installedFile);
        $packages = $installed->packages ?? [];

        foreach (is_array($packages) ? $packages : [] as $package) {
            $extra = $package instanceof \stdClass ? $package->extra ?? null : null;
            $seampact = $extra instanceof \stdClass ? $extra->seampact ?? null : null;

            if ($seampact instanceof \stdClass && property_exists($seampact, 'binary')) {
                $name = is_string($package->name ?? null) ? $package->name : 'an unnamed package';
                throw BinaryRefusedException::of(
                    BinaryFailureCode::OverrideNotRoot,
                    "The installed package '{$name}' sets `extra.seampact.binary`; only the root package's composer.json chooses the compiler binary.",
                    "Remove the key from '{$name}', or set the override in your own composer.json.",
                );
            }
        }
    }

    private static function readJson(string $file): \stdClass
    {
        $text = is_file($file) ? file_get_contents($file) : false;
        $document = $text === false ? null : json_decode($text, false);

        if (!$document instanceof \stdClass) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::PinInvalid,
                "'{$file}' is missing or is not a JSON object.",
                'Run seampact from the root package, or set COMPOSER to its composer.json.',
            );
        }

        return $document;
    }
}
