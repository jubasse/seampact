<?php

declare(strict_types=1);

namespace Seampact\Codegen;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\Deprecation;
use Seampact\Ir\Model\Operation;
use Seampact\Ir\Model\Origin;
use Seampact\Ir\Model\Response;
use Seampact\Ir\Model\ResponseHeader;
use Seampact\Ir\Model\ValueSourceIn;

/**
 * The response headers the boundary writes from a response's own IR headers (ADR 0004 section 7): the deprecation,
 * sunset and successor link of a deprecated operation, and the `ETag` of an item versioned by `If-Match` (grammar
 * section 6). The other response headers are written from the members that derive them: the idempotency replay,
 * `cache.etag` and the paging headers. The runtime's `ResponseHeaders` writes each entry.
 */
final class ResponseHeaderEntries
{
    public const TEXT = 'text';
    public const SUCCESSOR_LINK = 'successorLink';
    public const ENTITY_TAG = 'entityTag';
    private const DEPRECATION = 'deprecation';
    private const SUNSET = 'sunset';
    private const CONCURRENCY_DERIVATION = 'concurrency.version';
    private const CALENDAR_DATE = '/^(\d{4})-(\d{2})-(\d{2})$/D';
    private const YEAR_DIGITS = 4;

    public function __construct(private readonly ContractIR $ir, private readonly Refusals $refusals)
    {
    }

    /**
     * The entries of one response, each a header the boundary writes; a header it cannot write is refused by name.
     *
     * @return list<array<string, string>>
     */
    public function of(Operation $operation, Response $response, IrPlace $at): array
    {
        $entries = [];
        foreach ($response->headers as $index => $header) {
            $entry = $this->entry($operation, $header, $at->below('headers', $index));
            if ($entry !== null) {
                $entries[] = $entry;
            }
        }

        return $entries;
    }

    /**
     * RFC 9745: `@` and the unix seconds of the day at 00:00:00 UTC; null for a text that is no calendar date.
     */
    public static function deprecationValue(string $date): ?string
    {
        $midnight = self::utcMidnight($date);

        return $midnight === null ? null : '@' . $midnight->getTimestamp();
    }

    /** RFC 8594 and RFC 9110 section 5.6.7: the IMF-fixdate of the day at 00:00:00 GMT; null for no calendar date. */
    public static function sunsetValue(string $date): ?string
    {
        $midnight = self::utcMidnight($date);
        if ($midnight === null) {
            return null;
        }

        $year = str_pad((string) (int) $midnight->format('Y'), self::YEAR_DIGITS, '0', STR_PAD_LEFT);

        return $midnight->format('D, d M ') . $year . ' 00:00:00 GMT';
    }

    // Null for a header another member writes, or one refused here.
    /** @return array<string, string>|null */
    private function entry(Operation $operation, ResponseHeader $header, IrPlace $at): ?array
    {
        $semantic = $header->semantic?->value;
        if ($semantic === self::DEPRECATION || $semantic === self::SUNSET || $semantic === self::SUCCESSOR_LINK) {
            return $this->deprecationEntry($operation->deprecated, $header->name, $semantic, $at);
        }

        if (($header->derivedFrom->derivation ?? null) !== self::CONCURRENCY_DERIVATION) {
            return null;
        }

        return $this->entityTagEntry($operation, $header->name, $header->derivedFrom->from[0] ?? null, $at);
    }

    /** @return array<string, string>|null */
    private function deprecationEntry(?Deprecation $deprecated, string $name, string $semantic, IrPlace $at): ?array
    {
        if ($deprecated === null) {
            $this->refusals->inconsistent('ir.deprecation.headers', "A {$semantic} header on an operation that is not deprecated", $at);

            return null;
        }

        if ($semantic === self::SUCCESSOR_LINK) {
            return $this->successorLinkEntry($deprecated, $name, $at);
        }

        $date = $semantic === self::DEPRECATION ? $deprecated->since : $deprecated->sunset;
        $value = $semantic === self::DEPRECATION ? self::deprecationValue($date) : self::sunsetValue($date);
        if ($value === null) {
            $this->refusals->inconsistent('ir.deprecation.since', "The {$semantic} header's date '{$date}' is not a calendar date", $at);

            return null;
        }

        return ['kind' => self::TEXT, 'name' => $name, 'value' => $value];
    }

    /** @return array<string, string>|null */
    private function successorLinkEntry(Deprecation $deprecated, string $name, IrPlace $at): ?array
    {
        $successor = $deprecated->successor;
        $rel = $deprecated->successorRel;
        if ($successor === null || $rel === null) {
            $this->refusals->inconsistent('ir.deprecation.headers', 'A successor link header on an operation without its successor and relation', $at);

            return null;
        }

        if ($successor->api !== $this->ir->api->id) {
            $this->refusals->waiting('deprecated.successor.otherApi', "The successor link to operation '{$successor->id}' of api '{$successor->api}'", $at, Delivery::AfterOneZero);

            return null;
        }

        foreach ($this->ir->operations as $candidate) {
            if ($candidate->id === $successor->id) {
                return ['kind' => self::SUCCESSOR_LINK, 'name' => $name, 'path' => $candidate->path, 'rel' => $rel];
            }
        }

        $this->refusals->inconsistent('ir.deprecation.successor', "The successor '{$successor->id}' is no operation of the api", $at);

        return null;
    }

    /**
     * The `ETag` of an item versioned by `If-Match`, from the item property the version is compared with. A read of the
     * resource has no `concurrency`: its ETag is derived from the resource's, the origin its versioned writes name first,
     * and they give the field.
     *
     * @return array<string, string>|null
     */
    private function entityTagEntry(Operation $operation, string $name, ?Origin $resourceOrigin, IrPlace $at): ?array
    {
        if ($operation->concurrency !== null && $operation->concurrency->version->in->value === ValueSourceIn::Header) {
            return ['kind' => self::ENTITY_TAG, 'name' => $name, 'field' => $operation->concurrency->field];
        }

        $fields = [];
        foreach ($this->ir->operations as $candidate) {
            $concurrency = $candidate->concurrency;
            if ($concurrency !== null && $concurrency->version->in->value === ValueSourceIn::Header && self::isSameOrigin($concurrency->derivedFrom->from[0] ?? null, $resourceOrigin)) {
                $fields[$concurrency->field] = true;
            }
        }

        if (count($fields) === 1) {
            return ['kind' => self::ENTITY_TAG, 'name' => $name, 'field' => (string) array_key_first($fields)];
        }

        if (count($fields) > 1) {
            $this->refusals->inconsistent('concurrency.etag.field', 'The If-Match writes of the resource this ETag is derived from compare different fields', $at);

            return null;
        }

        $this->refusals->waiting('concurrency.etag.withoutWrite', 'An ETag of a resource whose If-Match writes are not operations of this api', $at, Delivery::AfterOneZero);

        return null;
    }

    private static function isSameOrigin(?Origin $left, ?Origin $right): bool
    {
        return $left !== null && $right !== null && $left->layer === $right->layer && $left->pointer === $right->pointer;
    }

    // The calendar day at 00:00:00 UTC, from its fields alone, never the machine's zone.
    private static function utcMidnight(string $date): ?\DateTimeImmutable
    {
        if (preg_match(self::CALENDAR_DATE, $date, $fields) !== 1 || !checkdate((int) $fields[2], (int) $fields[3], (int) $fields[1])) {
            return null;
        }

        return (new \DateTimeImmutable('@0'))->setDate((int) $fields[1], (int) $fields[2], (int) $fields[3]);
    }
}
