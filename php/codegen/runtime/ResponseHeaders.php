<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Response;

/**
 * The response headers the generated table derives (ADR 0004 section 7): a deprecated operation's Deprecation and
 * Sunset texts and its successor Link, written on every success but a 304, and the strong entity tag of an item
 * versioned by `If-Match` (grammar section 6), which a 304 keeps.
 */
final class ResponseHeaders
{
    private const TEXT = 'text';
    private const SUCCESSOR_LINK = 'successorLink';
    private const ENTITY_TAG = 'entityTag';
    private const PATH_PARAM = '/\{([^}]+)\}/';
    // RFC 3986 `unreserved`: every other octet of a path param's UTF-8 bytes is percent-encoded, `%` included.
    private const UNRESERVED_OCTET = '/[^A-Za-z0-9\-._~]/';
    // RFC 9110 section 8.8.3 `etagc`: a version whose text holds another character makes no strong entity tag.
    private const ENTITY_TAG_TEXT = '/^[\x21\x23-\x7e]*$/D';
    // 2^53 - 1: a JavaScript client, and the Node and Spring targets, hold no larger integer exactly.
    private const MAX_SAFE_INTEGER = 9007199254740991;

    private function __construct()
    {
    }

    /** Writes the deprecation headers of the operation's `$status` success on `$reply`. */
    public static function writeSuccessHeaders(BoundaryState $state, int $status, Response $reply): Response
    {
        foreach (self::entries($state, $status) as $entry) {
            $name = Ir::string($entry, 'name') ?? '';
            match (Ir::string($entry, 'kind')) {
                self::TEXT => $reply->headers->set($name, Ir::string($entry, 'value') ?? ''),
                self::SUCCESSOR_LINK => $reply->headers->set($name, self::successorLink($state, Ir::string($entry, 'path') ?? '', Ir::string($entry, 'rel') ?? '')),
                // The entity tag is written with the item it is read from (`entityTag`).
                self::ENTITY_TAG => null,
                default => throw new \LogicException("seampact: a response header entry of operation '{$state->operationId}' has an unknown kind; regenerate the code."),
            };
        }

        return $reply;
    }

    /**
     * The entity tag of the `$status` success, `[name, "<version>"]` from the encoded item's version field; null when
     * the response writes none. An item whose version is no integer or tag text is the handler's mistake: a 500.
     *
     * @return array{string, string}|null
     */
    public static function entityTag(BoundaryState $state, int $status, mixed $encodedItem): ?array
    {
        foreach (self::entries($state, $status) as $entry) {
            if (Ir::string($entry, 'kind') === self::ENTITY_TAG) {
                return [Ir::string($entry, 'name') ?? '', self::versionTag($state, Ir::string($entry, 'field') ?? '', $encodedItem)];
            }
        }

        return null;
    }

    /** Every octet of the value's UTF-8 bytes outside RFC 3986 `unreserved` percent-encoded. */
    public static function encodedPathSegment(string $value): string
    {
        return preg_replace_callback(self::UNRESERVED_OCTET, static fn (array $octet): string => sprintf('%%%02X', ord($octet[0])), $value) ?? '';
    }

    /** @return list<array<array-key, mixed>> */
    private static function entries(BoundaryState $state, int $status): array
    {
        return Ir::maps(Ir::map($state->contract->operationTypes($state->operationId), 'responseHeaders'), $status);
    }

    /**
     * RFC 8288: `<target>; rel="<rel>"`, the target the successor's path under the mount (and the public origin under
     * absolute URLs), each param the request's param of the same name, decoded then encoded as one path segment.
     */
    private static function successorLink(BoundaryState $state, string $path, string $rel): string
    {
        return '<' . ($state->publicOrigin ?? '') . $state->contract->mount . self::pathWithRequestParams($state, $path) . ">; rel=\"{$rel}\"";
    }

    /**
     * The path with each `{param}` written as the request's param of the same name, decoded then encoded as one path
     * segment, or as the segment `$given` holds for it.
     *
     * @param array<string, string> $given already encoded segments by param name
     */
    public static function pathWithRequestParams(BoundaryState $state, string $path, array $given = []): string
    {
        return preg_replace_callback(self::PATH_PARAM, static function (array $param) use ($state, $path, $given): string {
            if (isset($given[$param[1]])) {
                return $given[$param[1]];
            }

            $raw = $state->rawParameters[$param[1]] ?? throw new \LogicException("seampact: the path '{$path}' of operation '{$state->operationId}' names the param '{$param[1]}', which the request has not; regenerate the code.");

            // Step 1 refused a param that does not decode to UTF-8, so the value here always does.
            $decoded = WireValues::decodedSegment($raw) ?? throw new \LogicException("seampact: the path param '{$param[1]}' of operation '{$state->operationId}' passed step 1 without decoding to UTF-8.");

            return self::encodedPathSegment($decoded);
        }, $path) ?? '';
    }

    // The item's version as a strong entity tag, `"7"`: the field's safe integer or text, as the client sends it back.
    private static function versionTag(BoundaryState $state, string $field, mixed $item): string
    {
        $version = $item instanceof \stdClass && property_exists($item, $field) ? $item->{$field} : null;
        $isSafeInteger = is_int($version) && $version >= -self::MAX_SAFE_INTEGER && $version <= self::MAX_SAFE_INTEGER;
        $text = $isSafeInteger ? (string) $version : (is_string($version) ? $version : null);
        if ($text === null || preg_match(self::ENTITY_TAG_TEXT, $text) !== 1) {
            throw new BoundaryFailure(new \LogicException("seampact: the handler of operation '{$state->operationId}' returned an item whose version field '{$field}' is no safe integer (within 2^53 - 1) or entity tag text, so its ETag cannot be written."));
        }

        return "\"{$text}\"";
    }
}
