<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

use Symfony\Component\HttpFoundation\Request;

/**
 * Step 1's bounded body read: a declared `Content-Length` above the route's limit is refused before reading; the body
 * is read in chunks, `gzip` and `deflate` decoded as they arrive with ext-zlib, and refused as soon as the encoded or
 * the decoded bytes pass the limit, chunked bodies included. The app's `getContent()` keeps the bytes as received.
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

        // php://input reads again later, so the app's own `getContent()` still sees the bytes as received.
        $stream = fopen('php://input', 'rb');
        if ($stream === false) {
            throw new \RuntimeException('seampact: php://input could not be opened to read the request body.');
        }
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
        fclose($stream);

        return BodyRead::bytes($bytes);
    }
}
