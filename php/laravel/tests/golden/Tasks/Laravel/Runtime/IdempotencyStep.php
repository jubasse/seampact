<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\IdempotencyClaim;
use Seampact\Hooks\IdempotencyStore;
use Seampact\Hooks\StoredResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Idempotency at the boundary (ADR 0012 obligations): after step 8, the claim's fixed-size key and fingerprint, the
 * replay, running and mismatch answers; after step 10, the record completed with the reply that went out, or abandoned
 * after a server error or an error that forbids storing.
 */
final class IdempotencyStep
{
    private const DERIVED = 'derived';
    private const BOUNDARY = 'boundary';
    private const IN_PROGRESS_ROLE = 'idempotencyInProgress';
    private const KEY_REUSED_ROLE = 'idempotencyKeyReused';
    private const UNION_TAG_DERIVATION = 'union.headerTag';
    private const CONTENT_TYPE = 'content-type';
    private const CONTENT_HEADER_PREFIX = 'content-';
    private const AUTHORIZATION_HEADER = 'authorization';
    private const REPLAYED = 'true';
    private const CLIENT_ERROR_FLOOR = 400;
    private const SERVER_ERROR_FLOOR = 500;

    private function __construct()
    {
    }

    /**
     * Claims the request's key: the stored reply when it is replayed and the handler must not run, else null. A request
     * without a key, or to an operation the boundary does not enforce idempotency on, claims nothing.
     *
     * @param array<string, mixed> $input the decoded input by part (`path`, `query`, `headers`, `body`)
     * @throws ContractRefusal the key is running, or was used with another request
     */
    public static function begin(BoundaryState $state, array $input): ?Response
    {
        $operation = $state->contract->operation($state->operationId);
        $idempotency = Ir::map($operation, 'idempotency');
        if (Ir::string($idempotency, 'kind') !== self::DERIVED || Ir::string($idempotency, 'enforce') !== self::BOUNDARY) {
            return null;
        }

        $headers = $input['headers'] ?? null;
        $clientKey = $headers instanceof \stdClass ? ($headers->{Ir::string($idempotency, 'header') ?? ''} ?? null) : null;
        if (!is_string($clientKey)) {
            return null;
        }

        $key = Digests::hexOf([
            $state->contract->api,
            $state->operationId,
            Ir::string(Ir::map($operation, 'access'), 'identity') ?? '',
            $state->principal === null ? '' : Digests::hexOf([$state->principal]),
            $clientKey,
        ]);
        $claim = new IdempotencyClaim($key, self::fingerprint($state, $input), Ir::int($idempotency, 'lifetimeMs') ?? 0, AccessSteps::operationRef($state));

        $begun = self::store($state)->begin($claim);

        return match (true) {
            $begun instanceof IdempotencyBegin\Started => self::started($state, $key),
            $begun instanceof IdempotencyBegin\Running => throw AccessSteps::roleRefusal($state, self::IN_PROGRESS_ROLE),
            $begun instanceof IdempotencyBegin\Mismatch => throw AccessSteps::roleRefusal($state, self::KEY_REUSED_ROLE),
            $begun instanceof IdempotencyBegin\Replay => self::replay($state, $begun->response, Ir::string($idempotency, 'replayHeader')),
            default => throw new \LogicException('seampact: the idempotency store answered ' . $begun::class . ', which is none of IdempotencyBegin\'s classes.'),
        };
    }

    /**
     * Completes the claimed record with the reply that went out, or abandons it; a store failure is logged, since the
     * reply already stands.
     */
    public static function settle(BoundaryState $state, Response $response): void
    {
        $key = $state->idempotencyKey;
        if ($key === null) {
            return;
        }
        $state->idempotencyKey = null;

        try {
            $store = self::store($state);
            if (self::isKeptForReplay($response)) {
                $content = $response->getContent();
                $store->complete($key, new StoredResponse($response->getStatusCode(), self::storedHeaders($state, $response), $content === false ? '' : $content));
            } else {
                $store->abandon($key);
            }
        } catch (\Throwable $failure) {
            BoundaryLog::unexpected($state->hooks, $state->contract, $state->operationId, 'the idempotency store failed to record the reply, so a retry with the same key may run again; check the store\'s backend', $failure);
        }
    }

    /**
     * The digest a retry under the same key must match: the method, the contract path and the decoded input, its headers
     * cut to the header params the author declared and a union tag, in lower case. Any other header param the compiler
     * derives (a trace id, a deadline, the key, CSRF) and every credential header change on a retry (ADR 0012).
     *
     * @param array<string, mixed> $input
     */
    public static function fingerprint(BoundaryState $state, array $input): string
    {
        $operation = $state->contract->operation($state->operationId);
        $counted = array_diff(self::fingerprintHeaders($operation), self::credentialHeaders($state->contract, $operation));

        $headers = new \stdClass();
        $sent = $input['headers'] ?? null;
        foreach ($sent instanceof \stdClass ? get_object_vars($sent) : [] as $name => $value) {
            $lowerName = strtolower((string) $name);
            if (in_array($lowerName, $counted, true)) {
                $headers->{$lowerName} = $value;
            }
        }
        $digested = $input;
        $digested['headers'] = $headers;

        return Digests::hexOf([strtolower(Ir::string($operation, 'method') ?? ''), Ir::string($operation, 'path') ?? '', $digested]);
    }

    private static function store(BoundaryState $state): IdempotencyStore
    {
        $store = $state->hooks instanceof IdempotencyStoreLookup ? $state->hooks->idempotencyStore() : null;

        return $store ?? throw new \LogicException("seampact: the api '{$state->contract->api}' has no idempotency store for operation '{$state->operationId}'; register one.");
    }

    private static function started(BoundaryState $state, string $key): null
    {
        $state->idempotencyKey = $key;

        return null;
    }

    // The stored reply as it went out, authored by the boundary; a stored success carries the replay header.
    private static function replay(BoundaryState $state, StoredResponse $stored, ?string $replayHeader): Response
    {
        $reply = new Response($stored->body, $stored->status);
        foreach ($stored->headers as $header) {
            if ($replayHeader === null || strcasecmp($header->name, $replayHeader) !== 0) {
                $reply->headers->set($header->name, $header->value, false);
            }
        }
        if ($replayHeader !== null && $stored->status < self::CLIENT_ERROR_FLOOR) {
            $reply->headers->set($replayHeader, self::REPLAYED);
        }

        return $state->author($reply);
    }

    // An error reply its sender marked no-store is dropped as a server error is; a no-store success is kept, so a
    // retry never runs the write twice.
    private static function isKeptForReplay(Response $response): bool
    {
        $status = $response->getStatusCode();
        if ($status >= self::SERVER_ERROR_FLOOR) {
            return false;
        }
        if ($status < self::CLIENT_ERROR_FLOOR) {
            return true;
        }

        return !$response->headers->hasCacheControlDirective(Replies::NO_STORE_DIRECTIVE);
    }

    /**
     * The contract reply only: its content headers and the headers the operation declares for its status. Headers the
     * framework set beside it (session cookies, CORS, security headers) belong to the request that ran.
     *
     * @return list<StoredResponse\Header>
     */
    private static function storedHeaders(BoundaryState $state, Response $response): array
    {
        $declared = [];
        foreach (Ir::maps($state->contract->operation($state->operationId), 'responses') as $declaredResponse) {
            if (Ir::int($declaredResponse, 'status') === $response->getStatusCode()) {
                foreach (Ir::maps($declaredResponse, 'headers') as $header) {
                    $declared[] = strtolower(Ir::string($header, 'name') ?? '');
                }
            }
        }

        $headers = [];
        foreach ($response->headers->all() as $name => $values) {
            $lowerName = strtolower((string) $name);
            if ($lowerName !== self::CONTENT_TYPE && !str_starts_with($lowerName, self::CONTENT_HEADER_PREFIX) && !in_array($lowerName, $declared, true)) {
                continue;
            }
            foreach ($values as $value) {
                if (is_string($value)) {
                    $headers[] = new StoredResponse\Header($lowerName, $value);
                }
            }
        }

        return $headers;
    }

    /**
     * @param array<array-key, mixed> $operation
     * @return list<string>
     */
    private static function fingerprintHeaders(array $operation): array
    {
        $names = [];
        foreach (Ir::maps(Ir::map($operation, 'params'), 'header') as $param) {
            $derivedFrom = Ir::map($param, 'derivedFrom');
            if ($derivedFrom === [] || Ir::string($derivedFrom, 'derivation') === self::UNION_TAG_DERIVATION) {
                $names[] = strtolower(Ir::string($param, 'name') ?? '');
            }
        }

        return $names;
    }

    /**
     * The headers carrying a credential, lower case: a retry after a token or session refresh is the same request.
     *
     * @param array<array-key, mixed> $operation
     * @return list<string>
     */
    private static function credentialHeaders(ApiContract $contract, array $operation): array
    {
        $access = Ir::map($operation, 'access');
        $names = [];
        foreach (Ir::strings($access, 'schemes') as $schemeId) {
            $scheme = $contract->declaration('schemes', $schemeId);
            $kind = Ir::string($scheme, 'kind');
            if ($kind === 'bearer') {
                $names[] = self::AUTHORIZATION_HEADER;
            } elseif ($kind === 'header') {
                $names[] = strtolower(Ir::string($scheme, 'name') ?? '');
            }
        }

        $signed = Ir::string($contract->declaration('identities', Ir::string($access, 'identity') ?? ''), 'signed');
        if ($signed !== null) {
            $names[] = strtolower(Ir::string($contract->declaration('schemes', $signed), 'name') ?? '');
        }
        $csrfHeader = Ir::string(Ir::map($operation, 'csrf'), 'header');
        if ($csrfHeader !== null) {
            $names[] = strtolower($csrfHeader);
        }

        return $names;
    }
}
