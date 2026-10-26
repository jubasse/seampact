<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * Step 1's decoding: the path parameters percent-decoded from the raw path, the query from the raw query string, the
 * declared headers, and the body (media type, bounded read, `json_decode` with objects preserved), which the state
 * holds; each target hands the decoded parts to its own step 6.
 */
final class InputDecoding
{
    private const PAYLOAD_TOO_LARGE_ROLE = 'payloadTooLarge';
    private const UNSUPPORTED_MEDIA_TYPE_ROLE = 'unsupportedMediaType';
    private const MAX_JSON_DEPTH = 512;

    private function __construct()
    {
    }

    /** @throws ContractRefusal */
    public static function read(Request $request, BoundaryState $state): DecodedInput
    {
        $operation = $state->contract->operation($state->operationId);
        $params = Ir::map($operation, 'params');

        $path = [];
        foreach (Ir::maps($params, 'path') as $param) {
            $name = Ir::string($param, 'name') ?? '';
            $raw = $state->rawParameters[$name] ?? '';
            if (WireValues::decodedSegment($raw) === null) {
                throw AccessSteps::schemaInvalid($state, [['in' => 'path', 'pointer' => "/{$name}", 'rule' => 'type']]);
            }
            $path[$name] = WireValues::pathValue($raw, $param['type'] ?? null);
        }

        $query = [];
        $declaredQuery = [];
        foreach (Ir::maps($params, 'query') as $param) {
            $declaredQuery[Ir::string($param, 'name') ?? ''] = $param;
        }
        foreach (WireValues::rawQuery(RawTarget::query($request)) as $name => $rawValues) {
            $declared = $declaredQuery[$name] ?? null;
            $values = WireValues::listItems($rawValues, $declared['wire'] ?? null);
            $query[$name] = $declared === null
                ? (count($values) === 1 ? $values[0] : $values)
                : WireValues::queryValue($values, $declared['type'] ?? null);
        }
        $state->query = $query;

        $headers = [];
        foreach (Ir::maps($params, 'header') as $param) {
            $name = Ir::string($param, 'name') ?? '';
            $value = $request->headers->get($name);
            if ($value !== null) {
                $headers[$name] = WireValues::scalar($value, $param['type'] ?? null);
            }
        }

        $input = Ir::map($operation, 'input');
        if ($input !== [] && self::carriesBody($request)) {
            $state->body = self::body($request, $state, $input);
        }

        return new DecodedInput($path, $query, $headers);
    }

    /** @param array<array-key, mixed> $input */
    private static function body(Request $request, BoundaryState $state, array $input): mixed
    {
        // The bounded read comes first, so an oversized body answers 413 whatever its media type (ADR 0012).
        $limitBytes = Ir::int($input, 'bodyLimitBytes') ?? PHP_INT_MAX;
        $read = BodyReader::read($request, $limitBytes);
        if ($read->refusedRole === self::PAYLOAD_TOO_LARGE_ROLE) {
            $code = $state->contract->roleCode($state->operationId, self::PAYLOAD_TOO_LARGE_ROLE)
                ?? throw new \LogicException("seampact: operation '{$state->operationId}' has a body limit but no code for the role '" . self::PAYLOAD_TOO_LARGE_ROLE . "'.");
            throw new ContractRefusal($state->contract->api, $code, Replies::roleParams($state->contract, $state->operationId, $code, self::PAYLOAD_TOO_LARGE_ROLE, ['limitBytes' => $limitBytes]));
        }

        $media = strtolower(trim(explode(';', (string) $request->headers->get('Content-Type', ''))[0]));
        if ($read->bytes !== '' && $media !== (Ir::string($input, 'media') ?? '')) {
            throw AccessSteps::roleRefusal($state, self::UNSUPPORTED_MEDIA_TYPE_ROLE);
        }
        if ($read->refusedRole !== null) {
            throw $read->refusedRole === self::UNSUPPORTED_MEDIA_TYPE_ROLE
                ? AccessSteps::roleRefusal($state, self::UNSUPPORTED_MEDIA_TYPE_ROLE)
                : AccessSteps::schemaInvalid($state, [['in' => 'body', 'pointer' => '', 'rule' => 'type']]);
        }
        if (Ir::true($input, 'rawBody')) {
            $state->rawBody = $read->bytes;
        }
        if ($read->bytes === '') {
            return null;
        }

        try {
            return json_decode($read->bytes, false, self::MAX_JSON_DEPTH, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw AccessSteps::schemaInvalid($state, [['in' => 'body', 'pointer' => '', 'rule' => 'type']]);
        }
    }

    private static function carriesBody(Request $request): bool
    {
        $length = $request->headers->get('Content-Length');

        return ($length !== null && $length !== '0') || $request->headers->has('Transfer-Encoding');
    }
}
