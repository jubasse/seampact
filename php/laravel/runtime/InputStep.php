<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Http\Request;

/**
 * Step 1's decoding: the path parameters percent-decoded from the raw path, the query from the raw query string, the
 * declared headers, and the body (media type, bounded read, `json_decode` with objects preserved), stored as the
 * request's input tree, which the FormRequest's rules read in step 6.
 */
final class InputStep
{
    private const PAYLOAD_TOO_LARGE_ROLE = 'payloadTooLarge';
    private const UNSUPPORTED_MEDIA_TYPE_ROLE = 'unsupportedMediaType';
    private const MAX_JSON_DEPTH = 512;

    private function __construct()
    {
    }

    /** @throws ContractRefusal */
    public static function read(Request $request, BoundaryState $state): void
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
            $declaredQuery[Ir::string($param, 'name') ?? ''] = $param['type'] ?? null;
        }
        foreach (WireValues::query(RawTarget::query($request)) as $name => $values) {
            $query[$name] = array_key_exists($name, $declaredQuery) ? WireValues::queryValue($values, $declaredQuery[$name]) : (count($values) === 1 ? $values[0] : $values);
        }

        $headers = [];
        foreach (Ir::maps($params, 'header') as $param) {
            $name = Ir::string($param, 'name') ?? '';
            $value = $request->headers->get($name);
            if ($value !== null) {
                $headers[$name] = WireValues::scalar($value, $param['type'] ?? null);
            }
        }

        $input = Ir::map($operation, 'input');
        if ($input === [] || !self::carriesBody($request)) {
            $request->attributes->set(InputTree::attributeName($state->contract->api), InputTree::withoutBody($path, $query, $headers));

            return;
        }

        $state->body = self::body($request, $state, $input);
        $tree = $state->body === null ? InputTree::withoutBody($path, $query, $headers) : InputTree::withBody($path, $query, $headers, $state->body);
        $request->attributes->set(InputTree::attributeName($state->contract->api), $tree);
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
