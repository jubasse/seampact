<?php

declare(strict_types=1);

namespace Seampact\Ir\Https;

/**
 * A download over HTTPS, streamed chunk by chunk to a sink. The URL and every redirect must be `https:`, TLS is
 * always verified, redirects are bounded and followed by hand, each checked, one deadline covers every connection,
 * header and body read, the body stops at a byte cap, and a body shorter than its `Content-Length` is a failure. A
 * `caFile` replaces the system's certificate authorities. The request is HTTP/1.0 over a TLS socket, so the answer
 * is never chunked and each read is bounded by what is left of the deadline: a server that trickles its headers
 * cannot hold the download past it.
 */
final readonly class HttpsDownload
{
    private const REDIRECTS_MAX = 5;

    private const HTTP_OK = 200;

    private const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

    private const CHUNK_BYTES = 64 * 1024;

    private const SEVERAL_LOCATIONS = 'answered a redirect with more than one Location header';

    private const HOLDS_USER_INFO = 'holds a user name or password';

    private const HEAD_BYTES_MAX = 64 * 1024;

    private const HTTPS_PORT = 443;

    private const MICROSECONDS_PER_SECOND = 1_000_000;

    // What a request target cannot hold.
    private const CONTROL_OR_SPACE = '/[\x00-\x20\x7f]/';

    private const HOLDS_CONTROL_OR_SPACE = 'holds a control character or a space';

    public function __construct(private float $deadlineSeconds, private ?string $caFile = null)
    {
    }

    public static function isHttpsUrl(string $url): bool
    {
        if (preg_match(self::CONTROL_OR_SPACE, $url) === 1) {
            return false;
        }

        $parts = parse_url($url);

        return $parts !== false && strtolower($parts['scheme'] ?? '') === 'https' && ($parts['host'] ?? '') !== '';
    }

    /** Why `$url` is not requested at all, or null when it may be. */
    public static function untriedReason(string $url): ?string
    {
        if (preg_match(self::CONTROL_OR_SPACE, $url) === 1) {
            return 'it ' . self::HOLDS_CONTROL_OR_SPACE;
        }

        return self::isHttpsUrl($url) ? null : 'it is not an absolute https: URL';
    }

    /**
     * Streams the body `$url` answers into `$sink`, or says why it stopped; the sink may have received part of it.
     * What the sink throws propagates.
     *
     * @param callable(string): void $sink
     */
    public function stream(string $url, int $bytesMax, callable $sink): ?HttpsFailure
    {
        $untried = self::untriedReason($url);
        if ($untried !== null) {
            return new HttpsFailure($url, "was not tried: {$untried}");
        }

        $deadline = microtime(true) + $this->deadlineSeconds;

        for ($redirects = 0; ; $redirects++) {
            $answer = $this->get($url, $deadline, $bytesMax, $sink);
            if (!$answer instanceof HttpsHead) {
                return $answer;
            }

            if (!in_array($answer->status, self::REDIRECT_STATUSES, true) || $answer->locations === []) {
                return new HttpsFailure($url, "answered HTTP {$answer->status}");
            }

            if (count($answer->locations) > 1) {
                return new HttpsFailure($url, self::SEVERAL_LOCATIONS);
            }

            if ($redirects === self::REDIRECTS_MAX) {
                return new HttpsFailure($url, 'redirected more than ' . self::REDIRECTS_MAX . ' times');
            }

            $redirectRefusal = self::redirectRefusal($url, $answer->locations[0]);
            if ($redirectRefusal !== null) {
                return new HttpsFailure($url, $redirectRefusal);
            }

            $url = (string) self::resolved($url, $answer->locations[0]);
        }
    }

    /**
     * Null once a 200's body is streamed, else the head of the answer, or the failure.
     *
     * @param callable(string): void $sink
     */
    private function get(string $url, float $deadline, int $bytesMax, callable $sink): HttpsHead|HttpsFailure|null
    {
        $connection = $this->connect($url, $deadline);
        if ($connection instanceof HttpsFailure) {
            return $connection;
        }

        try {
            if (@fwrite($connection, self::request($url)) === false) {
                return new HttpsFailure($url, 'failed while sending the request');
            }

            $head = $this->head($connection, $url, $deadline);
            if ($head instanceof HttpsFailure || $head->status !== self::HTTP_OK) {
                return $head;
            }

            return $this->cappedBody($connection, $head, $url, $deadline, $bytesMax, $sink);
        } finally {
            fclose($connection);
        }
    }

    /** @return resource|HttpsFailure */
    private function connect(string $url, float $deadline)
    {
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            return $this->tookTooLong($url);
        }

        $parts = (array) parse_url($url);
        $host = is_string($parts['host'] ?? null) ? $parts['host'] : '';
        $port = is_int($parts['port'] ?? null) ? $parts['port'] : self::HTTPS_PORT;

        // The socket layer reports the TLS or connection reason in warnings.
        $warnings = [];
        set_error_handler(static function (int $level, string $message) use (&$warnings): bool {
            $warnings[] = $message;

            return true;
        });

        try {
            $connection = stream_socket_client("tls://{$host}:{$port}", $errorCode, $errorText, $remaining, STREAM_CLIENT_CONNECT, $this->context(trim($host, '[]')));
        } finally {
            restore_error_handler();
        }

        if ($connection !== false) {
            return $connection;
        }

        $reasons = $warnings === [] && is_string($errorText) && $errorText !== '' ? [$errorText] : $warnings;
        $reason = $reasons === [] ? 'the connection failed' : implode('; ', array_map(static fn (string $warning): string => self::withoutUrl($warning, $url), $reasons));

        return microtime(true) >= $deadline ? $this->tookTooLong($url) : new HttpsFailure($url, "failed: {$reason}");
    }

    /** @return resource */
    private function context(string $peerName)
    {
        $ssl = ['verify_peer' => true, 'verify_peer_name' => true, 'allow_self_signed' => false, 'peer_name' => $peerName, 'SNI_enabled' => true, 'crypto_method' => STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT];
        if ($this->caFile !== null) {
            $ssl['cafile'] = $this->caFile;
        }

        return stream_context_create(['ssl' => $ssl]);
    }

    // A user name and password in the URL are sent as basic credentials, as PHP's https wrapper does.
    private static function request(string $url): string
    {
        $parts = (array) parse_url($url);
        $path = is_string($parts['path'] ?? null) && $parts['path'] !== '' ? $parts['path'] : '/';
        $query = is_string($parts['query'] ?? null) ? "?{$parts['query']}" : '';
        $port = is_int($parts['port'] ?? null) ? ":{$parts['port']}" : '';
        $host = is_string($parts['host'] ?? null) ? $parts['host'] : '';
        $lines = ["GET {$path}{$query} HTTP/1.0", "Host: {$host}{$port}", 'User-Agent: seampact-ir', 'Accept-Encoding: identity', 'Connection: close'];

        if (is_string($parts['user'] ?? null)) {
            $password = is_string($parts['pass'] ?? null) ? $parts['pass'] : '';
            $lines[] = 'Authorization: Basic ' . base64_encode(urldecode($parts['user']) . ':' . urldecode($password));
        }

        return implode("\r\n", $lines) . "\r\n\r\n";
    }

    /** @param resource $connection */
    private function head($connection, string $url, float $deadline): HttpsHead|HttpsFailure
    {
        $received = '';

        while (($end = strpos($received, "\r\n\r\n")) === false) {
            if (strlen($received) > self::HEAD_BYTES_MAX) {
                return new HttpsFailure($url, 'sent headers over ' . self::HEAD_BYTES_MAX . ' bytes');
            }

            $chunk = $this->read($connection, $url, $deadline);
            if ($chunk instanceof HttpsFailure) {
                return $chunk;
            }

            if ($chunk === '') {
                return new HttpsFailure($url, 'closed the connection before the end of its headers');
            }

            $received .= $chunk;
        }

        if ($end > self::HEAD_BYTES_MAX) {
            return new HttpsFailure($url, 'sent headers over ' . self::HEAD_BYTES_MAX . ' bytes');
        }

        return HttpsHead::parse($url, substr($received, 0, $end), substr($received, $end + 4));
    }

    /**
     * @param resource $connection
     * @param callable(string): void $sink
     */
    private function cappedBody($connection, HttpsHead $head, string $url, float $deadline, int $bytesMax, callable $sink): ?HttpsFailure
    {
        if ($head->chunked) {
            return new HttpsFailure($url, 'answered an HTTP/1.0 request with a chunked body');
        }

        $received = 0;
        $chunk = $head->bodyStart;

        while (true) {
            // Bytes past the announced length are not part of the body.
            if ($head->contentLength !== null) {
                $chunk = substr($chunk, 0, $head->contentLength - $received);
            }

            $received += strlen($chunk);
            if ($received > $bytesMax) {
                return new HttpsFailure($url, "sent more than {$bytesMax} bytes ({$received} received), over the cap", $received);
            }

            if ($chunk !== '') {
                $sink($chunk);
            }

            if ($head->contentLength !== null && $received >= $head->contentLength) {
                return null;
            }

            $chunk = $this->read($connection, $url, $deadline);
            if ($chunk instanceof HttpsFailure) {
                return $chunk;
            }

            if ($chunk === '') {
                return $head->contentLength === null ? null : new HttpsFailure($url, "ended after {$received} of {$head->contentLength} bytes");
            }
        }
    }

    /**
     * The next bytes of the answer, '' at its end, or the failure. Each read waits at most what is left of the deadline.
     *
     * @param resource $connection
     */
    private function read($connection, string $url, float $deadline): string|HttpsFailure
    {
        $remaining = $deadline - microtime(true);
        if ($remaining <= 0) {
            return $this->tookTooLong($url);
        }

        $seconds = (int) floor($remaining);
        stream_set_timeout($connection, $seconds, max(1, (int) (($remaining - $seconds) * self::MICROSECONDS_PER_SECOND)));

        $chunk = @fread($connection, self::CHUNK_BYTES);
        if (stream_get_meta_data($connection)['timed_out']) {
            return $this->tookTooLong($url);
        }

        if ($chunk === false) {
            return new HttpsFailure($url, 'failed while reading the answer');
        }

        return $chunk;
    }

    private static function redirectRefusal(string $url, string $location): ?string
    {
        if (preg_match(self::CONTROL_OR_SPACE, $location) === 1) {
            return 'redirected to ' . UntrustedText::quoted(PrintableUrl::of($location)) . ', which ' . self::HOLDS_CONTROL_OR_SPACE;
        }

        $target = self::resolved($url, $location);
        if ($target === null || !self::isHttpsUrl($target)) {
            return 'redirected to ' . UntrustedText::quoted(PrintableUrl::of($location)) . ', which is not an https: URL';
        }

        if (array_key_exists('user', (array) parse_url($target))) {
            return 'redirected to ' . UntrustedText::quoted(PrintableUrl::of($location)) . ', which ' . self::HOLDS_USER_INFO;
        }

        return null;
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

    // PHP's socket warnings may repeat the URL, which may hold a token; the printable form replaces it.
    private static function withoutUrl(string $reason, string $url): string
    {
        return str_replace($url, PrintableUrl::of($url), preg_replace('/^[a-z_]+\([^)]*\):\s*/', '', $reason) ?? $reason);
    }

    private function tookTooLong(string $url): HttpsFailure
    {
        return new HttpsFailure($url, 'took over ' . (int) round($this->deadlineSeconds * 1000) . ' ms');
    }
}
