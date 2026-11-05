<?php

declare(strict_types=1);

namespace Seampact\Ir\Https;

/**
 * The status line and headers of one answer, as far as the download reads them: the status, the `Location` of a
 * redirect, the `Content-Length` a body must reach, whether the body is chunked, and the body bytes read with them.
 */
final readonly class HttpsHead
{
    private function __construct(
        public int $status,
        public ?string $location,
        public ?int $contentLength,
        public bool $chunked,
        public string $bodyStart,
    ) {
    }

    /** `$head` is the text before the blank line; `$url` names the answer in a failure. */
    public static function parse(string $url, string $head, string $bodyStart): self|HttpsFailure
    {
        $lines = explode("\r\n", $head);

        if (preg_match('#^HTTP/\d\.\d\s+(\d{3})(?:\s|$)#', $lines[0], $match) !== 1) {
            return new HttpsFailure($url, 'answered with no HTTP status line');
        }

        $location = null;
        $contentLengths = [];
        $chunked = false;

        foreach (array_slice($lines, 1) as $line) {
            [$name, $value] = array_pad(explode(':', $line, 2), 2, '');
            $value = trim($value);

            match (strtolower(trim($name))) {
                'location' => $location = $value,
                'content-length' => $contentLengths[] = $value,
                'transfer-encoding' => $chunked = $chunked || str_contains(strtolower($value), 'chunked'),
                default => null,
            };
        }

        $contentLength = self::contentLength($contentLengths);
        if ($contentLength === false) {
            return new HttpsFailure($url, 'sent an unreadable Content-Length');
        }

        return new self((int) $match[1], $location, $contentLength, $chunked, $bodyStart);
    }

    /**
     * The one length the headers give, null without one, false for a value that is not a number or two that differ.
     *
     * @param list<string> $values
     */
    private static function contentLength(array $values): int|false|null
    {
        if ($values === []) {
            return null;
        }

        $distinct = array_values(array_unique($values));
        if (count($distinct) !== 1 || preg_match('/^\d{1,18}$/D', $distinct[0]) !== 1) {
            return false;
        }

        return (int) $distinct[0];
    }
}
