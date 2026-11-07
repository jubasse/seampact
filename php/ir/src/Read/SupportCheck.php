<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/** The check of `irVersion`, `irRevision`, declaration kinds and features (the port of `checkIrSupport`). */
final class SupportCheck
{
    /** The package a refused version or revision tells the reader to update. */
    public const PACKAGE = 'seampact/ir';

    /**
     * Returns one named refusal per unsupported `irVersion`, different `irRevision`, unknown kind or unknown
     * feature, top level and per operation. An unsupported `irVersion` is returned alone: the rest of the
     * document may have another shape. A list that is missing or not an array is named
     * (`ir.support.malformed`), never read as empty. Stops after 100 refusals. Reads the document as untrusted
     * data and never throws.
     *
     * @return list<IrRefusal>
     */
    public static function check(mixed $ir, IrSupport $support): array
    {
        $document = $ir instanceof \stdClass ? $ir : new \stdClass();
        $version = self::member($document, 'irVersion');
        if (!self::isSupportedVersion($version, $support)) {
            return [self::versionRefusal($version, $support)];
        }

        $refusals = new RefusalList();
        $revision = self::member($document, 'irRevision');
        if (!self::isNumberEqual($revision, $support->irRevision)) {
            $refusals->add(self::revisionRefusal($revision, $support));
        }

        $kinds = self::listOf(self::member($document, 'kinds'), '/kinds', null, $refusals);
        self::unknownIn($kinds, $support->kinds, IrRefusalCode::KindUnsupported, '/kinds', null, $refusals);
        $features = self::listOf(self::member($document, 'features'), '/features', null, $refusals);
        self::unknownIn($features, $support->features, IrRefusalCode::FeatureUnsupported, '/features', null, $refusals);

        $operations = self::listOf(self::member($document, 'operations'), '/operations', null, $refusals);
        foreach ($operations as $index => $entry) {
            if ($refusals->isFull()) {
                break;
            }
            self::checkOperation($entry, $index, $support, $refusals);
        }

        return $refusals->all();
    }

    private static function checkOperation(mixed $entry, int $index, IrSupport $support, RefusalList $refusals): void
    {
        $operation = $entry instanceof \stdClass ? $entry : new \stdClass();
        $idValue = self::member($operation, 'id');
        $id = is_string($idValue) ? $idValue : '#' . $index;

        $kind = self::member($operation, 'kind');
        if (!self::isStringIn($kind, $support->kinds)) {
            $refusals->add(new IrRefusal(
                IrRefusalCode::KindUnsupported,
                '/operations/' . $index . '/kind',
                RefusalText::shown($kind),
                $support->kinds,
                $id,
                sprintf(
                    "The declaration kind '%s' of operation '%s' is not supported by this reader.",
                    RefusalText::inMessage(RefusalText::shown($kind)),
                    RefusalText::inMessage($id),
                ),
            ));
        }

        $member = '/operations/' . $index . '/features';
        $features = self::listOf(self::member($operation, 'features'), $member, $id, $refusals);
        self::unknownIn($features, $support->features, IrRefusalCode::FeatureUnsupported, $member, $id, $refusals);
    }

    private static function member(\stdClass $object, string $name): mixed
    {
        return property_exists($object, $name) ? $object->{$name} : Missing::Absent;
    }

    /**
     * The items of a list, or none and a refusal naming what was found instead.
     *
     * @return list<mixed>
     */
    private static function listOf(mixed $value, string $member, ?string $operation, RefusalList $refusals): array
    {
        if (is_array($value)) {
            return array_values($value);
        }

        $type = RefusalText::jsonType($value);
        $refusals->add(new IrRefusal(
            IrRefusalCode::SupportMalformed,
            $member,
            $type,
            ['array'],
            $operation,
            sprintf('%s is %s, not an array: this reader cannot check what it supports.', $member, $type),
        ));

        return [];
    }

    /**
     * @param list<mixed> $values
     * @param list<string> $known
     */
    private static function unknownIn(
        array $values,
        array $known,
        IrRefusalCode $code,
        string $member,
        ?string $operation,
        RefusalList $refusals,
    ): void {
        $what = $code === IrRefusalCode::KindUnsupported ? 'declaration kind' : 'feature';
        foreach ($values as $index => $value) {
            if ($refusals->isFull()) {
                return;
            }
            if (self::isStringIn($value, $known)) {
                continue;
            }

            $where = $operation === null ? '' : sprintf(" in operation '%s'", RefusalText::inMessage($operation));
            $refusals->add(new IrRefusal(
                $code,
                $member . '/' . $index,
                RefusalText::shown($value),
                $known,
                $operation,
                sprintf(
                    "The %s '%s'%s is not supported by this reader.",
                    $what,
                    RefusalText::inMessage(RefusalText::shown($value)),
                    $where,
                ),
            ));
        }
    }

    /** @param list<string> $known */
    private static function isStringIn(mixed $value, array $known): bool
    {
        return is_string($value) && in_array($value, $known, true);
    }

    private static function isNumberEqual(mixed $value, int $expected): bool
    {
        if (is_int($value)) {
            return $value === $expected;
        }

        return is_float($value) && $value === (float) $expected;
    }

    private static function isSupportedVersion(mixed $version, IrSupport $support): bool
    {
        foreach ($support->irVersions as $supported) {
            if (self::isNumberEqual($version, $supported)) {
                return true;
            }
        }

        return false;
    }

    private static function versionRefusal(mixed $version, IrSupport $support): IrRefusal
    {
        $expected = array_map(static fn (int $supported): string => (string) $supported, $support->irVersions);

        return new IrRefusal(
            IrRefusalCode::VersionUnsupported,
            '/irVersion',
            RefusalText::shown($version),
            $expected,
            null,
            sprintf(
                'irVersion %s is not one this reader reads (%s). Update the %s package to one that reads it.',
                RefusalText::inMessage(RefusalText::shown($version)),
                implode(', ', $expected),
                self::PACKAGE,
            ),
        );
    }

    private static function revisionRefusal(mixed $revision, IrSupport $support): IrRefusal
    {
        return new IrRefusal(
            IrRefusalCode::RevisionMismatch,
            '/irRevision',
            RefusalText::shown($revision),
            [(string) $support->irRevision],
            null,
            sprintf(
                'irRevision %s differs from the revision this reader was built for (%d). Update the %s package to the revision of the compiler.',
                RefusalText::inMessage(RefusalText::shown($revision)),
                $support->irRevision,
                self::PACKAGE,
            ),
        );
    }
}
