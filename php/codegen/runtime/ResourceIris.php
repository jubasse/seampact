<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * The slots a format writes about the resource a body describes (ADR 0002 section 13): `$resource`, the item schema's
 * type name, and `$self` and `$itemSelf`, the member URL of an item built from its id property, or the request URL when
 * the body has no id property or the contract serves no member route to build it from.
 */
final class ResourceIris
{
    public const SELF_SLOT = 'self';
    public const RESOURCE_SLOT = 'resource';
    public const ITEM_SELF_SLOT = 'itemSelf';
    private const ITEM_SHAPE = 'item';
    private const PLACEHOLDER = '/^\{([^}]+)\}$/';

    private function __construct()
    {
    }

    /**
     * `$self` and `$resource` of a success body.
     *
     * @param array<array-key, mixed> $declared the response the body answers
     * @return array<string, mixed>
     */
    public static function successSlots(Request $request, BoundaryState $state, array $declared, string $shape, mixed $payload): array
    {
        $member = $shape === self::ITEM_SHAPE ? self::memberUrl($state, $payload) : null;
        $slots = [self::SELF_SLOT => $member ?? self::requestUrl($request, $state)];

        $resource = self::resourceName($state->contract, $declared);
        if ($resource !== null) {
            $slots[self::RESOURCE_SLOT] = $resource;
        }

        return $slots;
    }

    /** The item schema's `typeName`, else its name; null for a body that is no named schema. */
    /** @param array<array-key, mixed> $declared */
    public static function resourceName(ApiContract $contract, array $declared): ?string
    {
        $schemaId = Ir::string(Ir::map($declared, 'body'), 'schema');
        if ($schemaId === null) {
            return null;
        }

        return Ir::string($contract->declaration('schemas', $schemaId), 'typeName') ?? $schemaId;
    }

    /**
     * The member URL of a record of the operation's resource: the path of the resource's member route, its id
     * placeholder written with the record's id property and the others with the request's own values. Null when the
     * record has no usable id or the contract has no member route of that resource to read the path from.
     */
    public static function memberUrl(BoundaryState $state, mixed $record): ?string
    {
        $operation = $state->contract->operation($state->operationId);
        $idProperty = Ir::string(Ir::map($operation, 'resource'), 'idProperty');
        $id = $idProperty === null ? null : self::property($record, $idProperty);
        $member = self::memberRoute($state->contract, $operation);
        if (!(is_string($id) || is_int($id)) || $member === null) {
            return null;
        }

        try {
            $idSegment = WireValues::pathSegment($member['idParam'], $id);
        } catch (\InvalidArgumentException) {
            // An id that cannot be one path segment (empty, a dot segment, not UTF-8) has no member route to name.
            return null;
        }

        $segments = [];
        foreach (explode('/', $member['path']) as $segment) {
            $segments[] = self::segmentValue($state, $segment, $member['idParam'], $idSegment);
        }

        return in_array(null, $segments, true) ? null : ($state->publicOrigin ?? '') . $state->contract->mount . implode('/', $segments);
    }

    /** The URL the client called: its path, then its query when it sent one. */
    public static function requestUrl(Request $request, BoundaryState $state): string
    {
        $query = RawTarget::query($request);

        return ($state->publicOrigin ?? '') . WireValues::linkSafePath(RawTarget::path($request)) . ($query === '' ? '' : "?{$query}");
    }

    /**
     * The member route of the operation's resource beside the operation: the path of a route of that resource through
     * its id placeholder, whose parent path the operation's own path starts with.
     *
     * @param array<array-key, mixed> $operation
     * @return ?array{path: string, idParam: string}
     */
    private static function memberRoute(ApiContract $contract, array $operation): ?array
    {
        $type = Ir::string(Ir::map($operation, 'resource'), 'type');
        $ownPath = Ir::string($operation, 'path') ?? '';
        if ($type === null) {
            return null;
        }

        foreach ($contract->operationIds() as $candidateId) {
            $candidate = $contract->operation($candidateId);
            $resource = Ir::map($candidate, 'resource');
            $idParam = Ir::string($resource, 'idParam');
            $path = Ir::string($candidate, 'path') ?? '';
            $idStart = $idParam === null ? false : strpos($path, '{' . $idParam . '}');
            if (Ir::string($resource, 'type') !== $type || $idParam === null || $idStart === false) {
                continue;
            }

            $memberPath = substr($path, 0, $idStart + strlen($idParam) + 2);
            $parentPath = substr($memberPath, 0, $idStart - 1);
            if ($ownPath === $parentPath || str_starts_with($ownPath, "{$parentPath}/")) {
                return ['path' => $memberPath, 'idParam' => $idParam];
            }
        }

        return null;
    }

    // A literal segment as written, the id placeholder as the record's id, any other placeholder as the request's value.
    private static function segmentValue(BoundaryState $state, string $segment, string $idParam, string $idSegment): ?string
    {
        if (preg_match(self::PLACEHOLDER, $segment, $placeholder) !== 1) {
            return $segment;
        }
        if ($placeholder[1] === $idParam) {
            return $idSegment;
        }

        $raw = $state->rawParameters[$placeholder[1]] ?? null;
        $decoded = $raw === null ? null : WireValues::decodedSegment($raw);

        return $decoded === null ? null : ResponseHeaders::encodedPathSegment($decoded);
    }

    private static function property(mixed $record, string $name): mixed
    {
        return match (true) {
            $record instanceof \stdClass => $record->{$name} ?? null,
            is_array($record) => $record[$name] ?? null,
            default => null,
        };
    }
}
