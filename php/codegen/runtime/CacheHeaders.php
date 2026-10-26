<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The cache headers of a success the boundary writes (ADR 0012 step 10): `Cache-Control` by caller kind, `Vary`, and
 * the strong ETag over the body bytes, with its 304 when `If-None-Match` names it. The ETag is the SHA-256 base64url of
 * the body as on the Node and Spring targets, so a client's tag stays valid across them.
 */
final class CacheHeaders
{
    public const NOT_MODIFIED = 304;
    private const ETAG_HEADER = 'ETag';
    private const VARY_HEADER = 'Vary';
    private const IF_NONE_MATCH_HEADER = 'If-None-Match';
    private const WEAK_ETAG_PREFIX = 'W/';
    private const ANY_TAG = '*';
    private const ANONYMOUS = 'anonymous';
    private const IDENTIFIED = 'identified';

    private function __construct()
    {
    }

    /**
     * Writes the operation's cache headers on `$reply`, whose content is the body's bytes; answers the ETag's 304,
     * with the same headers and no body, when `If-None-Match` names it.
     */
    public static function written(Request $request, BoundaryState $state, Response $reply): Response
    {
        $cache = Ir::map($state->contract->operation($state->operationId), 'cache');
        if ($cache === []) {
            return $reply;
        }

        $cacheControl = Ir::true($cache, 'noStore')
            ? Replies::NO_STORE_DIRECTIVE
            : self::cacheControlOf($cache, $state->principal === null ? self::ANONYMOUS : self::IDENTIFIED);
        if ($cacheControl !== null) {
            $reply->headers->set(Replies::CACHE_CONTROL_HEADER, $cacheControl);
        }

        $vary = Ir::strings($cache, 'vary');
        if ($vary !== []) {
            $reply->headers->set(self::VARY_HEADER, implode(', ', $vary));
        }

        if (!Ir::true($cache, 'etag')) {
            return $reply;
        }

        $content = $reply->getContent();
        $etag = '"' . Digests::base64UrlOfBytes($content === false ? '' : $content) . '"';
        $reply->headers->set(self::ETAG_HEADER, $etag);
        if (!self::ifNoneMatchHolds($request->headers->get(self::IF_NONE_MATCH_HEADER), $etag)) {
            return $reply;
        }

        $reply->setContent('');
        $reply->setStatusCode(self::NOT_MODIFIED);
        $reply->headers->remove('Content-Type');

        return $reply;
    }

    /** @param array<array-key, mixed> $cache */
    private static function cacheControlOf(array $cache, string $callerKind): ?string
    {
        foreach (Ir::maps($cache, 'perCallerKind') as $entry) {
            if (Ir::string($entry, 'caller') === $callerKind) {
                return Ir::string($entry, 'cacheControl');
            }
        }

        return null;
    }

    private static function ifNoneMatchHolds(?string $ifNoneMatch, string $etag): bool
    {
        if ($ifNoneMatch === null) {
            return false;
        }

        foreach (explode(',', $ifNoneMatch) as $tag) {
            $trimmed = trim($tag);
            if ($trimmed === self::ANY_TAG || $trimmed === $etag || $trimmed === self::WEAK_ETAG_PREFIX . $etag) {
                return true;
            }
        }

        return false;
    }
}
