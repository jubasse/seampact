<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * The slots a format writes about the resource a body describes (ADR 0002 section 13): `$resource`, the item schema's
 * type name, and `$self` and `$itemSelf`, the member URL of an item built from its id property. `$self` is the request URL
 * for a body that is no collection item; the generator refuses a format that writes a member URL for a resource with
 * no member route to build it from.
 */
final class ResourceIris
{
    public const SELF_SLOT = 'self';
    public const RESOURCE_SLOT = 'resource';
    public const ITEM_SELF_SLOT = 'itemSelf';
    private const ITEM_SHAPE = 'item';

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
        $member = $shape === self::ITEM_SHAPE ? self::memberUrl($state, self::memberRoute($state), $payload) : null;
        $slots = [self::SELF_SLOT => $member ?? self::requestUrl($request, $state)];

        $resource = self::resourceName($state->contract, $declared);
        if ($resource !== null) {
            $slots[self::RESOURCE_SLOT] = $resource;
        }

        return $slots;
    }

    /**
     * The item schema's `typeName`, else its name; null for a body that is no named schema.
     *
     * @param array<array-key, mixed> $declared
     */
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
     * record has no usable id or there is no member route.
     *
     * @param ?array{path: string, idParam: string} $route from `memberRoute`, resolved once per reply
     */
    public static function memberUrl(BoundaryState $state, ?array $route, mixed $record): ?string
    {
        $operation = $state->contract->operation($state->operationId);
        $idProperty = Ir::string(Ir::map($operation, 'resource'), 'idProperty');
        $id = $idProperty === null ? null : self::property($record, $idProperty);
        if (!(is_string($id) || is_int($id)) || $route === null) {
            return null;
        }

        try {
            // Refuses the ids that are no one path segment; the segment itself is written with the one encoder below.
            WireValues::pathSegment($route['idParam'], $id);
            $idSegment = ResponseHeaders::encodedPathSegment((string) $id);
        } catch (\InvalidArgumentException) {
            // An id that cannot be one path segment (empty, a dot segment, not UTF-8) has no member route to name.
            return null;
        }

        return ($state->publicOrigin ?? '') . $state->contract->mount . ResponseHeaders::pathWithRequestParams($state, $route['path'], [$route['idParam'] => $idSegment]);
    }

    /** The URL the client called: its path, then its query when it sent one. */
    public static function requestUrl(Request $request, BoundaryState $state): string
    {
        $query = RawTarget::query($request);

        return ($state->publicOrigin ?? '') . WireValues::linkSafePath(RawTarget::path($request)) . ($query === '' ? '' : "?{$query}");
    }

    /**
     * The member route of the operation's resource, read once per reply.
     *
     * @return ?array{path: string, idParam: string}
     */
    public static function memberRoute(BoundaryState $state): ?array
    {
        $contract = $state->contract;
        $operation = $contract->operation($state->operationId);

        return MemberRoute::find(
            Ir::string(Ir::map($operation, 'resource'), 'type'),
            Ir::string($operation, 'path') ?? '',
            (static function () use ($contract): \Generator {
                foreach ($contract->operationIds() as $candidateId) {
                    $candidate = $contract->operation($candidateId);
                    $resource = Ir::map($candidate, 'resource');

                    yield ['type' => Ir::string($resource, 'type'), 'idParam' => Ir::string($resource, 'idParam'), 'path' => Ir::string($candidate, 'path') ?? ''];
                }
            })(),
        );
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
