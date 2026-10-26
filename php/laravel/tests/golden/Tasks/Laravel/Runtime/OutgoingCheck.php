<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Response;

/**
 * Step 10, the outgoing response check (ADR 0016): a reply the boundary wrote passes; a success it did not write is a
 * violation; a declared error status from another writer is held up to `MAX_CHECKED_ERROR_BODY_BYTES` and must carry
 * one of the operation's codes for that status in the api's format; any other status is a violation.
 */
final class OutgoingCheck
{
    public const MAX_CHECKED_ERROR_BODY_BYTES = 65536;
    private const ERROR_FLOOR = 400;
    private const JSON_MEDIA = 'application/json';

    private function __construct()
    {
    }

    /** The violation found, null when the reply passes. */
    public static function violation(BoundaryState $state, Response $response, ?\Throwable $exception): ?string
    {
        if ($state->authored($response)) {
            return null;
        }

        $status = $response->getStatusCode();
        if ($status < self::ERROR_FLOOR) {
            return "a {$status} reply the boundary did not write";
        }

        // Once admitted, only the boundary or an exception's rendering writes the reply (ADR 0023 "The outgoing check").
        if ($state->admitted && $exception === null) {
            return "a {$status} reply written after the access middleware admitted the request";
        }

        $codes = self::declaredCodes($state, $status);
        if ($codes === []) {
            return "the undeclared status {$status}";
        }

        $content = $response->getContent();
        if ($content === false || strlen($content) > self::MAX_CHECKED_ERROR_BODY_BYTES) {
            return "a {$status} error body that cannot be checked";
        }

        $errorMedia = Ir::string(Ir::map($state->contract->format($state->operationId), 'error'), 'media') ?? self::JSON_MEDIA;
        $media = strtolower(trim(explode(';', (string) $response->headers->get('Content-Type', ''))[0]));
        if ($media !== strtolower($errorMedia)) {
            return "a {$status} error body that is not {$errorMedia}";
        }

        $codeMember = self::codeMember($state);
        try {
            $body = json_decode(self::decoded($response, $content), false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return "a {$status} error body that is not JSON";
        }
        $code = $body instanceof \stdClass && $codeMember !== null ? (get_object_vars($body)[$codeMember] ?? null) : null;

        return is_string($code) && in_array($code, $codes, true) ? null : "a {$status} error body without a declared code";
    }

    /** @return list<string> */
    private static function declaredCodes(BoundaryState $state, int $status): array
    {
        $codes = [];
        foreach (Ir::maps($state->contract->operation($state->operationId), 'errors') as $error) {
            $code = Ir::string($error, 'code');
            if ($code !== null && $state->contract->statusOf($code) === $status) {
                $codes[] = $code;
            }
        }

        return $codes;
    }

    // The top-level member of the format's error body that the `code` slot fills.
    private static function codeMember(BoundaryState $state): ?string
    {
        foreach (Ir::maps(Ir::map(Ir::map($state->contract->format($state->operationId), 'error'), 'body'), 'members') as $member) {
            $value = Ir::map($member, 'value');
            if (Ir::string($value, 'kind') === 'slot' && Ir::string($value, 'slot') === 'code' && Ir::list($value, 'path') === []) {
                return Ir::string(Ir::map($member, 'name'), 'text');
            }
        }

        return null;
    }

    private static function decoded(Response $response, string $content): string
    {
        $decoded = match (strtolower((string) $response->headers->get('Content-Encoding', ''))) {
            'gzip' => @gzdecode($content),
            'deflate' => @gzuncompress($content),
            default => $content,
        };

        return $decoded === false ? '' : $decoded;
    }
}
