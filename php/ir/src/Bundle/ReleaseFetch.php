<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The release-asset channel, as `fetch-release.ts`: the bundle tarball downloaded over HTTPS. A bundle comes from the
 * network, so the URL and every redirect must be `https:`, TLS is always verified, redirects are bounded and
 * followed by hand, each checked, the download has one deadline for every request and body, and it stops at the
 * archive cap; the archive reader then checks the bytes. A `caFile` replaces the system's certificate authorities.
 */
final readonly class ReleaseFetch
{
    public const DEADLINE_SECONDS = 60.0;

    private const REDIRECTS_MAX = 5;

    private const HTTP_OK = 200;

    private const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

    private const CHUNK_BYTES = 64 * 1024;

    private const RELEASE_FIX = 'Check the release URL and that the asset is reachable over HTTPS, then run again.';

    public function __construct(private float $deadlineSeconds = self::DEADLINE_SECONDS, private ?string $caFile = null)
    {
    }

    /** Why the source's URL cannot be downloaded from, before any request or cache read. */
    public static function sourceProblem(ReleaseSource $source): ?BundleFailure
    {
        if (self::isHttpsUrl($source->url)) {
            return null;
        }

        return new BundleFailure(
            BundleFailureCode::ReleaseUrl,
            'The release URL ' . BundleText::quoted(PrintableUrl::of($source->url)) . ' is not an absolute https: URL.',
            'Name the bundle tarball by its https: URL.',
        );
    }

    /** The tarball bytes the source's URL serves, or why they could not be fetched. */
    public function download(ReleaseSource $source): string|BundleFailure
    {
        $problem = self::sourceProblem($source);
        if ($problem !== null) {
            return $problem;
        }

        $deadline = microtime(true) + $this->deadlineSeconds;
        $url = $source->url;

        for ($redirects = 0; ; $redirects++) {
            $answer = $this->get($url, $deadline);
            if ($answer instanceof BundleFailure) {
                return $answer;
            }

            [$status, $location, $body] = $answer;
            if ($body !== null) {
                return $body;
            }

            if (!in_array($status, self::REDIRECT_STATUSES, true) || $location === null) {
                return self::failed($url, "answered HTTP {$status}");
            }

            if ($redirects === self::REDIRECTS_MAX) {
                return self::failed($url, 'redirected more than ' . self::REDIRECTS_MAX . ' times');
            }

            $target = self::resolved($url, $location);
            if ($target === null || !self::isHttpsUrl($target)) {
                return self::failed($url, 'redirected to ' . BundleText::quoted(PrintableUrl::of($location)) . ', which is not an https: URL');
            }

            $url = $target;
        }
    }

    /** @return array{int, ?string, string|BundleFailure|null}|BundleFailure the status, the location, and a 200's body */
    private function get(string $url, float $deadline): array|BundleFailure
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

            return microtime(true) >= $deadline ? $this->tookTooLong($url) : self::failed($url, "failed: {$reason}");
        }

        try {
            $headers = stream_get_meta_data($stream)['wrapper_data'] ?? [];
            [$status, $location] = self::statusAndLocation(is_array($headers) ? $headers : []);
            if ($status !== self::HTTP_OK) {
                return [$status, $location, null];
            }

            return [$status, $location, $this->cappedBody($stream, $url, $deadline)];
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

    /** @param resource $stream */
    private function cappedBody($stream, string $url, float $deadline): string|BundleFailure
    {
        $body = '';

        while (!feof($stream)) {
            $remaining = $deadline - microtime(true);
            if ($remaining <= 0) {
                return $this->tookTooLong($url);
            }

            stream_set_timeout($stream, (int) ceil($remaining));
            $chunk = fread($stream, self::CHUNK_BYTES);
            if ($chunk === false || stream_get_meta_data($stream)['timed_out']) {
                return microtime(true) >= $deadline ? $this->tookTooLong($url) : self::failed($url, 'failed while reading the body');
            }

            $body .= $chunk;
            if (strlen($body) > BundleLayout::ARCHIVE_BYTES_MAX) {
                return new BundleFailure(
                    BundleFailureCode::ArchiveTooLarge,
                    'The release tarball holds more than ' . BundleLayout::ARCHIVE_BYTES_MAX . ' bytes (' . strlen($body) . ' received), over the cap.',
                    BundleLayout::NOT_A_BUNDLE_FIX,
                    null,
                    (string) BundleLayout::ARCHIVE_BYTES_MAX,
                );
            }
        }

        return $body;
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

    private static function isHttpsUrl(string $url): bool
    {
        $parts = parse_url($url);

        return $parts !== false && strtolower($parts['scheme'] ?? '') === 'https' && ($parts['host'] ?? '') !== '';
    }

    // PHP's stream warnings repeat the URL, which may hold a token; the printable form replaces it.
    private static function withoutUrl(string $reason, string $url): string
    {
        return str_replace($url, PrintableUrl::of($url), preg_replace('/^fopen\([^)]*\):\s*/', '', $reason) ?? $reason);
    }

    private function tookTooLong(string $url): BundleFailure
    {
        return self::failed($url, 'took over ' . (int) round($this->deadlineSeconds * 1000) . ' ms');
    }

    private static function failed(string $url, string $what): BundleFailure
    {
        return new BundleFailure(
            BundleFailureCode::ReleaseFailed,
            'Downloading the bundle from ' . BundleText::quoted(PrintableUrl::of($url)) . " {$what}.",
            self::RELEASE_FIX,
        );
    }
}
