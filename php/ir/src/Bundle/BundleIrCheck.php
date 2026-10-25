<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelException;
use Seampact\Ir\Read\IrRefusalCode;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Read\MustActCheck;
use Seampact\Ir\Read\RefusalText;
use Seampact\Ir\Read\SupportCheck;

/**
 * Step 3 of the pinned-bundle check, for one api: the IR file is UTF-8 JSON with no reserved key, declares the
 * irVersion and irRevision the manifest lists, is of a version this reader reads at its exact irRevision (before
 * 1.0, ADR 0005), with the lists it reads well-formed, validates against the open IR JSON Schema with no
 * must-act unknown, then decodes into the IR model. Kinds and features are a target's question (`IrReader::read`
 * with its own support), not the bundle's.
 */
final class BundleIrCheck
{
    private const FIX = 'Rebuild the bundle with a compiler of this IR revision, or use the seampact release that reads it.';

    private const LISTED_PROBLEM_LIMIT = 5;

    private const SUPPORT_CODES = [
        IrRefusalCode::VersionUnsupported->value => BundleFailureCode::IrVersion,
        IrRefusalCode::RevisionMismatch->value => BundleFailureCode::IrRevision,
        IrRefusalCode::SupportMalformed->value => BundleFailureCode::IrInvalid,
    ];

    private function __construct()
    {
    }

    /** The api's IR, or the failure naming its file and the values that differ. */
    public static function check(BundleApi $api, string $bytes): ContractIR|BundleFailure
    {
        $parsed = UntrustedJson::parse($bytes);
        if ($parsed->problem !== null) {
            return new BundleFailure(BundleFailureCode::IrUnreadable, "'{$api->file}' {$parsed->problem}.", self::FIX, $api->file);
        }

        $document = $parsed->document;
        $hasVersion = $document instanceof \stdClass && property_exists($document, 'irVersion');
        $hasRevision = $document instanceof \stdClass && property_exists($document, 'irRevision');
        $declaredVersion = $hasVersion ? $document->irVersion : null;
        $declaredRevision = $hasRevision ? $document->irRevision : null;

        if (!self::isNumber($declaredVersion, $api->irVersion) || !self::isNumber($declaredRevision, $api->irRevision)) {
            return new BundleFailure(
                BundleFailureCode::IrDeclaration,
                "'{$api->file}' declares irVersion " . self::shown($declaredVersion, $hasVersion) . ' and irRevision '
                    . self::shown($declaredRevision, $hasRevision) . "; the manifest lists {$api->irVersion} and {$api->irRevision}.",
                self::FIX,
                $api->file,
                "{$api->irVersion}.{$api->irRevision}",
                self::plain($declaredVersion, $hasVersion) . '.' . self::plain($declaredRevision, $hasRevision),
            );
        }

        $support = self::supportFailure($api, $document);
        if ($support !== null) {
            return $support;
        }

        $problems = [...SpecSchema::ir()->problems($document), ...self::mustActProblems($document)];
        if ($problems !== []) {
            return self::invalid($api, BundleText::listedProblems($problems, self::LISTED_PROBLEM_LIMIT));
        }

        try {
            return ContractIR::fromJson($document);
        } catch (IrModelException $error) {
            return self::invalid($api, BundleText::quoted($error->getMessage()));
        }
    }

    private static function invalid(BundleApi $api, string $problems): BundleFailure
    {
        return new BundleFailure(
            BundleFailureCode::IrInvalid,
            "'{$api->file}' is not valid under the IR JSON Schema: {$problems}.",
            self::FIX,
            $api->file,
        );
    }

    private static function isNumber(mixed $value, int $expected): bool
    {
        return (is_int($value) || is_float($value)) && (float) $value === (float) $expected;
    }

    // A declared value in a message, as the compiler's `quote` shows it: a string quoted, a missing one `undefined`.
    private static function shown(mixed $value, bool $present): string
    {
        if (!$present) {
            return 'undefined';
        }

        return is_string($value) ? BundleText::quoted($value) : RefusalText::inMessage(self::plain($value, $present));
    }

    // A declared value as `String(value)` gives it: a string bare.
    private static function plain(mixed $value, bool $present): string
    {
        if (!$present) {
            return 'undefined';
        }

        return $value === null ? 'null' : RefusalText::shown($value);
    }

    private static function supportFailure(BundleApi $api, mixed $document): ?BundleFailure
    {
        foreach (SupportCheck::check($document, IrSupport::ofModel(kinds: [])) as $refusal) {
            $code = self::SUPPORT_CODES[$refusal->code->value] ?? null;

            // `ir.kind.unsupported`, `ir.feature.unsupported`, `ir.must-act.unknown` and `ir.nesting.too-deep` are
            // the generator's: it reads the IR again with its own support, which this check, knowing no kind, lacks.
            if ($code === null) {
                continue;
            }

            $expected = implode(', ', $refusal->expected);

            return new BundleFailure(
                $code,
                "'{$api->file}' holds " . BundleText::quoted($refusal->value) . ' at ' . BundleText::quoted($refusal->member)
                    . "; this reader reads {$expected}.",
                self::FIX,
                $api->file,
                $expected,
                $refusal->value,
            );
        }

        return null;
    }

    /** @return list<string> */
    private static function mustActProblems(mixed $document): array
    {
        return array_map(
            static fn ($refusal): string => 'at ' . BundleText::quoted($refusal->member) . ' an unknown ' . BundleText::quoted($refusal->value),
            MustActCheck::check($document),
        );
    }
}
