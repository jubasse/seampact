<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * Step 1's bounded body read: a declared `Content-Length` above the route's limit is refused before reading; the body
 * is read in chunks, `gzip` and `deflate` decoded as they arrive with ext-zlib, and refused as soon as the encoded or
 * the decoded bytes pass the limit, chunked bodies included. The body is read from the request's content stream
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
        $inflate = $window === null ? null : inflate_init($window);
        if ($inflate === false) {
            throw new \RuntimeException('seampact: ext-zlib could not start decoding the request body.');
        }
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
            if ($inflate !== null) {
                $chunk = @inflate_add($inflate, $chunk, ZLIB_SYNC_FLUSH);
                if ($chunk === false) {
                    return BodyRead::refused(self::CORRUPT);
                }
            }
            $bytes .= $chunk;
            if (strlen($bytes) > $limitBytes) {
                return BodyRead::refused(self::TOO_LARGE);
            }
        }
        return BodyRead::bytes($bytes);
    }
}
