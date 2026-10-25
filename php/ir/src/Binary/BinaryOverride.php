<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The root package's `extra.seampact.binary`: a local `path` with its `sha256`; a `version` with the `sha256` of
 * every release asset; or a mirror `url` (a base to which `/<asset>` is appended) with the `sha256` of every asset,
 * never the embedded ones. A relative `path` resolves against the root `composer.json`'s directory.
 */
final readonly class BinaryOverride
{
    private const KEYS = ['path', 'version', 'url', 'sha256'];

    private const FIX = 'Give `path` with the `sha256` of that file, or `version` or `url` with a `sha256` object of '
        . 'every release asset, as the release SHA256SUMS lists them.';

    /** @param array<string, string> $sha256ByAsset */
    private function __construct(
        public BinaryOverrideSource $source,
        public string $value,
        public ?string $sha256,
        public array $sha256ByAsset,
    ) {
    }

    /**
     * @param string $composerFile the root `composer.json`, for messages and the relative `path`
     * @throws BinaryRefusedException `binary.pin-missing` or `binary.pin-invalid`
     */
    public static function read(mixed $binary, string $composerFile): self
    {
        $where = "`extra.seampact.binary` of '{$composerFile}'";

        if (!$binary instanceof \stdClass) {
            throw self::invalid("{$where} is not an object");
        }

        $unknown = array_diff(array_keys(get_object_vars($binary)), self::KEYS);
        if ($unknown !== []) {
            throw self::invalid("{$where} has the unknown key '" . implode("', '", $unknown) . "'");
        }

        $sources = array_values(array_filter(
            BinaryOverrideSource::cases(),
            static fn (BinaryOverrideSource $source): bool => property_exists($binary, $source->value),
        ));
        if (count($sources) !== 1) {
            throw self::invalid("{$where} must set exactly one of `path`, `version` and `url`");
        }

        $source = $sources[0];
        $value = $binary->{$source->value};
        if (!is_string($value) || $value === '') {
            throw self::invalid("{$where} has a `{$source->value}` that is not a non-empty string");
        }

        if (!property_exists($binary, 'sha256')) {
            throw self::missing("{$where} gives no `sha256`");
        }

        if ($source === BinaryOverrideSource::Path) {
            return new self($source, self::resolvedPath($value, $composerFile), self::fileHash($binary->sha256, $where), []);
        }

        if (!$binary->sha256 instanceof \stdClass) {
            throw self::invalid("{$where} has a `sha256` that is not an object of one hash per release asset");
        }

        return new self($source, $value, null, self::hashesOfEveryAsset($binary->sha256, $where));
    }

    /**
     * One valid hash per release asset and no other key.
     *
     * @return array<string, string>
     * @throws BinaryRefusedException
     */
    public static function hashesOfEveryAsset(\stdClass $hashes, string $where): array
    {
        $byAsset = [];
        foreach (get_object_vars($hashes) as $asset => $hash) {
            if (!in_array((string) $asset, ReleaseAssets::BINARIES, true)) {
                throw self::invalid("{$where} has a hash for '{$asset}', which is no release binary (" . implode(', ', ReleaseAssets::BINARIES) . ')');
            }

            $byAsset[(string) $asset] = self::fileHash($hash, "{$where}, asset '{$asset}',");
        }

        $missing = array_diff(ReleaseAssets::BINARIES, array_keys($byAsset));
        if ($missing !== []) {
            throw self::missing("{$where} has no hash for '" . implode("', '", $missing) . "'");
        }

        return $byAsset;
    }

    private static function fileHash(mixed $hash, string $where): string
    {
        if (!ReleaseAssets::isSha256($hash)) {
            throw self::invalid("{$where} has a `sha256` that is not 64 lowercase hexadecimal digits");
        }

        return $hash;
    }

    private static function resolvedPath(string $path, string $composerFile): string
    {
        $isAbsolute = str_starts_with($path, '/') || str_starts_with($path, '\\') || preg_match('/^[A-Za-z]:[\\\\\/]/', $path) === 1;

        return $isAbsolute ? $path : dirname($composerFile) . DIRECTORY_SEPARATOR . $path;
    }

    private static function invalid(string $problem): BinaryRefusedException
    {
        return BinaryRefusedException::of(BinaryFailureCode::PinInvalid, "The binary override is invalid: {$problem}.", self::FIX);
    }

    private static function missing(string $problem): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::PinMissing,
            "The binary override is not pinned: {$problem}; seampact never runs a binary it cannot check.",
            self::FIX,
        );
    }
}
