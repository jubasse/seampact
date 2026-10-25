<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The manifest as a verifier reads it: at most `BundleLayout::MANIFEST_BYTES_MAX` bytes of UTF-8 JSON with no byte
 * order mark, no reserved key and no key given twice in one object, valid under the manifest schema, then under
 * the rules no schema states (`BundleManifestRules`).
 */
final class BundleManifestReader
{
    // A refusal lists at most this many problems, then how many more there are.
    private const LISTED_PROBLEM_LIMIT = 5;

    private function __construct()
    {
    }

    /** The manifest of `$bytes`, or the failure naming why it is refused. */
    public static function read(string $bytes): BundleManifest|BundleFailure
    {
        if (strlen($bytes) > BundleLayout::MANIFEST_BYTES_MAX) {
            return self::tooLarge(strlen($bytes));
        }

        $parsed = UntrustedJson::parse($bytes);
        if ($parsed->problem !== null) {
            return self::invalid([$parsed->problem]);
        }

        $duplicateAt = UntrustedJson::duplicateKeyPointer($bytes);
        if ($duplicateAt !== null) {
            return self::invalid(['gives the key at ' . BundleText::quoted($duplicateAt) . ' twice in one object']);
        }

        $schemaProblems = SpecSchema::manifest()->problems($parsed->document);
        if ($schemaProblems !== [] || !$parsed->document instanceof \stdClass) {
            return self::invalid($schemaProblems);
        }

        $manifest = BundleManifest::ofSchemaValid($parsed->document);
        $ruleProblems = BundleManifestRules::problems($manifest);

        return $ruleProblems === [] ? $manifest : self::invalid($ruleProblems);
    }

    /** The failure of a manifest over the cap, refused before it is read. */
    public static function tooLarge(int $size): BundleFailure
    {
        $cap = BundleLayout::MANIFEST_BYTES_MAX;

        return new BundleFailure(
            BundleFailureCode::ManifestTooLarge,
            "'" . BundleLayout::MANIFEST_FILE . "' holds {$size} bytes, over the cap of {$cap}.",
            'Check that the source names a seampact bundle; a manifest this large is not one.',
            BundleLayout::MANIFEST_FILE,
            (string) $cap,
            (string) $size,
        );
    }

    /** @param list<string> $problems */
    private static function invalid(array $problems): BundleFailure
    {
        return new BundleFailure(
            BundleFailureCode::ManifestInvalid,
            "'" . BundleLayout::MANIFEST_FILE . "' is not a valid manifest: "
                . BundleText::listedProblems($problems, self::LISTED_PROBLEM_LIMIT) . '.',
            BundleLayout::REBUILD_FIX,
            BundleLayout::MANIFEST_FILE,
        );
    }
}
