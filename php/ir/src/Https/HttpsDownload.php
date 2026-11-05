<?php

declare(strict_types=1);

namespace Seampact\Ir\Https;

use Seampact\Ir\Bundle\BundleText;
use Seampact\Ir\Bundle\PrintableUrl;

/**
 * A download over HTTPS, streamed chunk by chunk to a sink. The URL and every redirect must be `https:`, TLS is
 * always verified, redirects are bounded and followed by hand, each checked, one deadline covers every request and
 * body, and the body stops at a byte cap. A `caFile` replaces the system's certificate authorities.
 */
final readonly class HttpsDownload
{
    private const REDIRECTS_MAX = 5;

    private const HTTP_OK = 200;

    private const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

    private const CHUNK_BYTES = 64 * 1024;

    public function __construct(private float $deadlineSeconds, private ?string $caFile = null)
    {
    }

    public static function isHttpsUrl(string $url): bool
    {
        $parts = parse_url($url);

        return $parts !== false && strtolower($parts['scheme'] ?? '') === 'https' && ($parts['host'] ?? '') !== '';
    }

    /**
     * Streams the body `$url` answers into `$sink`, or says why it stopped; the sink may have received part of it.
     *
     * @param callable(string): void $sink
     */
    public function stream(string $url, int $bytesMax, callable $sink): ?HttpsFailure
    {
        if (!self::isHttpsUrl($url)) {
            return new HttpsFailure($url, 'was not tried: it is not an absolute https: URL');
        }

        $deadline = microtime(true) + $this->deadlineSeconds;

        for ($redirects = 0; ; $redirects++) {
            $answer = $this->get($url, $deadline, $bytesMax, $sink);
            if (!is_array($answer)) {
                return $answer;
            }

            [$status, $location] = $answer;
            if (!in_array($status, self::REDIRECT_STATUSES, true) || $location === null) {
                return new HttpsFailure($url, "answered HTTP {$status}");
            }

            if ($redirects === self::REDIRECTS_MAX) {
                return new HttpsFailure($url, 'redirected more than ' . self::REDIRECTS_MAX . ' times');
            }

            $target = self::resolved($url, $location);
            if ($target === null || !self::isHttpsUrl($target)) {
                return new HttpsFailure($url, 'redirected to ' . BundleText::quoted(PrintableUrl::of($location)) . ', which is not an https: URL');
            }

            $url = $target;
        }
    }

    /**
     * Null once a 200's body is streamed, else the status and `Location` of the answer, or the failure.
     *
     * @param callable(string): void $sink
     * @return array{int, ?string}|HttpsFailure|null
     */
    private function get(string $url, float $deadline, int $bytesMax, callable $sink): array|HttpsFailure|null
    {
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            return $this->tookTooLong($url);
        }

        // The stream wrapper reports the TLS or connection reason in warnings before its last one.
        $warnings = [];
        set_error_handler(static function (int $level, string $message) use (&$warnings): bool {
            $warnings[] = $message;

            return true;
        });

        try {
            $stream = fopen($url, 'rb', false, $this->context($remaining));
        } finally {
            restore_error_handler();
        }

        if ($stream === false) {
            $reason = $warnings === [] ? 'the connection failed' : implode('; ', array_map(static fn (string $warning): string => self::withoutUrl($warning, $url), $warnings));

            return microtime(true) >= $deadline ? $this->tookTooLong($url) : new HttpsFailure($url, "failed: {$reason}");
        }

        try {
            $headers = stream_get_meta_data($stream)['wrapper_data'] ?? [];
            [$status, $location] = self::statusAndLocation(is_array($headers) ? $headers : []);
            if ($status !== self::HTTP_OK) {
                return [$status, $location];
            }

            return $this->cappedBody($stream, $url, $deadline, $bytesMax, $sink);
        } finally {
            fclose($stream);
        }
    }

    /** @return resource */
    private function context(float $remaining)
    {
        $ssl = ['verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false];
        if ($this->caFile !== null) {
            $ssl['cafile'] = $this->caFile;
        }

        return stream_context_create([
            'http' => ['method' => 'GET', 'follow_location' => 0, 'max_redirects' => 1, 'ignore_errors' => true, 'timeout' => $remaining],
            'ssl' => $ssl,
        ]);
    }

    /**
     * @param resource $stream
     * @param callable(string): void $sink
     */
    private function cappedBody($stream, string $url, float $deadline, int $bytesMax, callable $sink): ?HttpsFailure
    {
        $received = 0;

        while (!feof($stream)) {
            $remaining = $deadline - microtime(true);
            if ($remaining <= 0) {
                return $this->tookTooLong($url);
            }

            stream_set_timeout($stream, (int) ceil($remaining));
            $chunk = fread($stream, self::CHUNK_BYTES);
            if ($chunk === false || stream_get_meta_data($stream)['timed_out']) {
                return microtime(true) >= $deadline ? $this->tookTooLong($url) : new HttpsFailure($url, 'failed while reading the body');
            }

            $received += strlen($chunk);
            if ($received > $bytesMax) {
                return new HttpsFailure($url, "sent more than {$bytesMax} bytes ({$received} received), over the cap", $received);
            }

            $sink($chunk);
        }

        return null;
    }

    /**
     * The last response's status and `Location` (the wrapper lists the headers of each response it read).
     *
     * @param array<mixed> $headers
     * @return array{int, ?string}
     */
    private static function statusAndLocation(array $headers): array
    {
        $status = 0;
        $location = null;

        foreach ($headers as $header) {
            if (!is_string($header)) {
                continue;
            }

            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $header, $match) === 1) {
                $status = (int) $match[1];
                $location = null;
            } elseif (preg_match('/^location:\s*(.+)$/i', $header, $match) === 1) {
                $location = trim($match[1]);
            }
        }

        return [$status, $location];
    }

    private static function resolved(string $base, string $location): ?string
    {
        if (preg_match('#^[A-Za-z][A-Za-z0-9+.-]*:#', $location) === 1) {
            return $location;
        }

        $parts = parse_url($base);
        if ($parts === false || !isset($parts['scheme'], $parts['host'])) {
            return null;
        }

        $origin = "{$parts['scheme']}://{$parts['host']}" . (isset($parts['port']) ? ":{$parts['port']}" : '');
        if (str_starts_with($location, '//')) {
            return "{$parts['scheme']}:{$location}";
        }
        if (str_starts_with($location, '/')) {
            return $origin . $location;
        }

        $directory = preg_replace('#/[^/]*$#', '/', $parts['path'] ?? '/') ?? '/';

        return $origin . $directory . $location;
    }

    // PHP's stream warnings repeat the URL, which may hold a token; the printable form replaces it.
    private static function withoutUrl(string $reason, string $url): string
    {
        return str_replace($url, PrintableUrl::of($url), preg_replace('/^fopen\([^)]*\):\s*/', '', $reason) ?? $reason);
    }

    private function tookTooLong(string $url): HttpsFailure
    {
        return new HttpsFailure($url, 'took over ' . (int) round($this->deadlineSeconds * 1000) . ' ms');
    }
}
