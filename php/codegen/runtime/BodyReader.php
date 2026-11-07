<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * Step 1's bounded body read: a declared `Content-Length` above the route's limit is refused before reading; the body
 * is read in chunks, `gzip` and `deflate` decoded as they arrive with ext-zlib, and refused as soon as the encoded or
 * the decoded bytes pass the limit, chunked bodies included. A `gzip` body is read member after member; bytes after
 * the end of a `deflate` stream, or after a `gzip` member that do not start another member, are refused. The body is read from the request's content stream
 * (`getContent(true)`), so the app's `getContent()` keeps the bytes as received.
 */
final class BodyReader
{
    public const TOO_LARGE = 'payloadTooLarge';
    public const UNSUPPORTED_ENCODING = 'unsupportedMediaType';
    public const CORRUPT = 'schemaInvalid';
    private const CHUNK_BYTES = 65536;

    private function __construct()
    {
    }

    /** The decoded bytes, or the role of the refusal: `payloadTooLarge`, `unsupportedMediaType` or `schemaInvalid`. */
    public static function read(Request $request, int $limitBytes): BodyRead
    {
        $declaredLength = $request->headers->get('Content-Length');
        if ($declaredLength !== null && ctype_digit($declaredLength) && (int) $declaredLength > $limitBytes) {
            return BodyRead::refused(self::TOO_LARGE);
        }

        $encoding = strtolower(trim((string) $request->headers->get('Content-Encoding', 'identity')));
        $window = match ($encoding) {
            'identity', '' => null,
            'gzip', 'x-gzip' => ZLIB_ENCODING_GZIP,
            'deflate' => ZLIB_ENCODING_DEFLATE,
            default => false,
        };
        if ($window === false) {
            return BodyRead::refused(self::UNSUPPORTED_ENCODING);
        }

        // Read through the request, so an in-process request (a feature test) sends its body; php://input and the
        // request's own stream are both read again later, so the app's `getContent()` still sees the bytes as received.
        $stream = $request->getContent(true);
        $inflate = $window === null ? null : self::startInflate($window);
        $received = 0;
        $bytes = '';
        while (!feof($stream)) {
            $chunk = fread($stream, self::CHUNK_BYTES);
            if ($chunk === false) {
                break;
            }
            $received += strlen($chunk);
            if ($received > $limitBytes) {
                return BodyRead::refused(self::TOO_LARGE);
            }
            if ($inflate === null) {
                $bytes .= $chunk;
            } else {
                $inflate = self::inflateChunk($inflate, $window, $chunk, $bytes, $limitBytes);
                if (is_string($inflate)) {
                    return BodyRead::refused($inflate);
                }
            }
            if (strlen($bytes) > $limitBytes) {
                return BodyRead::refused(self::TOO_LARGE);
            }
        }
        // A stream cut before its end would hand a truncated body on as if it were whole.
        if ($inflate !== null && $received > 0 && inflate_get_status($inflate) !== ZLIB_STREAM_END) {
            return BodyRead::refused(self::CORRUPT);
        }

        return BodyRead::bytes($bytes);
    }

    /**
     * Decodes one chunk onto `$bytes`, starting a new context for each `gzip` member the chunk begins; the context
     * the next chunk goes on with, or the role of the refusal.
     */
    private static function inflateChunk(
        \InflateContext $inflate,
        int $window,
        string $chunk,
        string &$bytes,
        int $limitBytes,
    ): \InflateContext|string {
        while ($chunk !== '') {
            if (inflate_get_status($inflate) === ZLIB_STREAM_END) {
                if ($window !== ZLIB_ENCODING_GZIP) {
                    return self::CORRUPT;
                }
                $inflate = self::startInflate($window);
            }

            $readBefore = inflate_get_read_len($inflate);
            $decoded = @inflate_add($inflate, $chunk, ZLIB_SYNC_FLUSH);
            if ($decoded === false) {
                return self::CORRUPT;
            }
            $bytes .= $decoded;
            if (strlen($bytes) > $limitBytes) {
                return self::TOO_LARGE;
            }

            // A member that ends inside the chunk leaves the rest of the chunk unread: the next member, or bytes to refuse.
            $chunk = inflate_get_status($inflate) === ZLIB_STREAM_END
                ? substr($chunk, inflate_get_read_len($inflate) - $readBefore)
                : '';
        }

        return $inflate;
    }

    private static function startInflate(int $window): \InflateContext
    {
        $inflate = inflate_init($window);
        if ($inflate === false) {
            throw new \RuntimeException('seampact: ext-zlib could not start decoding the request body.');
        }

        return $inflate;
    }
}
