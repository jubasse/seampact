<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The pin `seampact/ir` ships in `resources/binaries.json`: the binary version and one SHA-256 per release asset,
 * written at release time from the release `SHA256SUMS`. Until the compiler is published it holds no version and
 * no hash.
 */
final readonly class BinaryPins
{
    public const EMBEDDED_FILE = __DIR__ . '/../../resources/binaries.json';

    // The version of every package of the checkout until the release stamps it: a pin at it hashes no released binary.
    private const DEVELOPMENT_VERSION = '0.0.0';

    /** @param array<string, string> $sha256ByAsset */
    public function __construct(public string $version, public array $sha256ByAsset)
    {
    }

    /**
     * The embedded pins, or null while they are empty (before publication).
     *
     * @throws BinaryRefusedException `binary.pin-invalid` when the file is not a version with every asset's hash, or
     *         pins the development version
     */
    public static function embedded(string $resource = self::EMBEDDED_FILE): ?self
    {
        $text = file_get_contents($resource);
        $pins = $text === false ? null : json_decode($text, false);

        if (!$pins instanceof \stdClass || !property_exists($pins, 'version') || !property_exists($pins, 'sha256')) {
            throw self::invalid("'{$resource}' is not a JSON object with `version` and `sha256`");
        }

        if ($pins->version === null && $pins->sha256 == new \stdClass()) {
            return null;
        }

        if (!is_string($pins->version) || $pins->version === '' || !$pins->sha256 instanceof \stdClass) {
            throw self::invalid("'{$resource}' has no version string or no `sha256` object");
        }

        if ($pins->version === self::DEVELOPMENT_VERSION) {
            throw self::invalid("'{$resource}' pins version " . self::DEVELOPMENT_VERSION . ', a development pin of no released binary');
        }

        return new self($pins->version, BinaryOverride::hashesOfEveryAsset($pins->sha256, "'{$resource}'"));
    }

    private static function invalid(string $problem): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::PinInvalid,
            "The binary pins of seampact/ir are unreadable: {$problem}.",
            'Reinstall seampact/ir; its pins are written at release time from the release SHA256SUMS.',
        );
    }
}
