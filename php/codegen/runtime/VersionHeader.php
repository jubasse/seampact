<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * The version a write sends in a request header (grammar section 6), read before the input is validated: a missing or
 * empty one answers the `preconditionRequired` role (428), never `schemaInvalid`. `If-Match` carries it as one entity
 * tag, strong or weak (a compressing server or proxy weakens the tag it read, and the version is the same): `*` names no
 * version and is missing too, and a list or a value that is no tag can match no version, so it answers the
 * `preconditionFailed` role (412). The handler receives the version unquoted and compares it with the stored one.
 */
final class VersionHeader
{
    private const HEADER_SOURCE = 'header';
    private const IF_MATCH_HEADER = 'if-match';
    private const PRECONDITION_REQUIRED_ROLE = 'preconditionRequired';
    private const PRECONDITION_FAILED_ROLE = 'preconditionFailed';
    private const ANY_ENTITY_TAG = '*';
    private const ENTITY_TAG = '/^(?:W\/)?"([^"]*)"$/D';

    private function __construct()
    {
    }

    /**
     * The version an `If-Match` tag carries, null for another header source or none.
     *
     * @throws ContractRefusal the operation's 428 or 412 code when the version header is missing or can match no version
     */
    public static function sent(Request $request, BoundaryState $state): ?string
    {
        $name = self::headerName($state);
        if ($name === null) {
            return null;
        }

        $sent = trim(implode(', ', array_map(strval(...), $request->headers->all($name))));
        if ($sent === '') {
            throw AccessSteps::roleRefusal($state, self::PRECONDITION_REQUIRED_ROLE);
        }

        if (strtolower($name) !== self::IF_MATCH_HEADER) {
            return null;
        }

        if ($sent === self::ANY_ENTITY_TAG) {
            throw AccessSteps::roleRefusal($state, self::PRECONDITION_REQUIRED_ROLE);
        }

        if (preg_match(self::ENTITY_TAG, $sent, $tag) !== 1) {
            throw AccessSteps::roleRefusal($state, self::PRECONDITION_FAILED_ROLE);
        }

        return $tag[1];
    }

    /** The validated headers with the `If-Match` value as the handler compares it: `"7"` and `W/"7"` both hand over `7`. */
    public static function handedOver(BoundaryState $state, ?string $version, \stdClass $headers): \stdClass
    {
        $name = self::headerName($state);
        if ($version === null || $name === null) {
            return $headers;
        }

        $handed = clone $headers;
        foreach (Ir::maps(Ir::map($state->contract->operation($state->operationId), 'params'), 'header') as $param) {
            $paramName = Ir::string($param, 'name') ?? '';
            if (strcasecmp($paramName, $name) === 0) {
                $handed->{$paramName} = $version;

                return $handed;
            }
        }

        throw new \LogicException("seampact: operation '{$state->operationId}' reads its version from the header '{$name}', which it declares no param for; regenerate the code.");
    }

    private static function headerName(BoundaryState $state): ?string
    {
        $version = Ir::map(Ir::map($state->contract->operation($state->operationId), 'concurrency'), 'version');
        if (Ir::string($version, 'in') !== self::HEADER_SOURCE) {
            return null;
        }

        return Ir::string($version, 'name') ?? throw new \LogicException("seampact: operation '{$state->operationId}' reads its version from a header without its name; regenerate the code.");
    }
}
