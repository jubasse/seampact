<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

use Seampact\Ir\Bundle\PrintableUrl;
use Seampact\Ir\Https\HttpsDownload;

/**
 * Where the compiler binary is downloaded from, and how (ADR 0010, "Fetch"): a release asset of the seampact GitHub
 * releases, or a mirror base URL to which `/<asset>` is appended. The download is `HttpsDownload`'s, with the
 * system's certificate authorities and no proxy, as the bundle channel's, a deadline sized for a binary of about
 * 100 MB on a slow link, and a cap well above any release asset.
 */
final readonly class BinaryDownload
{
    public const RELEASE_BASE_URL = 'https://github.com/jubasse/seampact/releases/download';

    public const DEADLINE_SECONDS = 600.0;

    public const BYTES_MAX = 512 * 1024 * 1024;

    private const FETCH_FIX = 'Check that the URL serves the release asset over HTTPS, or set `extra.seampact.binary` in '
        . 'your root composer.json to a mirror `url` or a `path`, with their hashes.';

    /** `$caFile` replaces the system's certificate authorities; tests serve the assets themselves. */
    public function __construct(
        private string $releaseBaseUrl = self::RELEASE_BASE_URL,
        private float $deadlineSeconds = self::DEADLINE_SECONDS,
        private ?string $caFile = null,
    ) {
    }

    /** The URL of `$asset` in the release of `$version`, tagged `v<version>`. */
    public function releaseUrl(string $version, string $asset): string
    {
        return "{$this->releaseBaseUrl}/v" . rawurlencode($version) . "/{$asset}";
    }

    public static function mirrorUrl(string $baseUrl, string $asset): string
    {
        return rtrim($baseUrl, '/') . "/{$asset}";
    }

    /**
     * Refuses a URL that is not `https:` before the cache is touched.
     *
     * @throws BinaryRefusedException `binary.fetch-failed`
     */
    public static function refuseUnlessHttps(string $url): void
    {
        if (!HttpsDownload::isHttpsUrl($url)) {
            throw self::fetchFailed($url, 'was not tried: it is not an absolute https: URL');
        }
    }

    /**
     * Streams the asset at `$url` into `$sink`.
     *
     * @param callable(string): void $sink
     * @throws BinaryRefusedException `binary.fetch-failed`, or what the sink throws
     */
    public function stream(string $url, callable $sink): void
    {
        $failure = (new HttpsDownload($this->deadlineSeconds, $this->caFile))->stream($url, self::BYTES_MAX, $sink);

        if ($failure !== null) {
            throw self::fetchFailed($failure->url, $failure->reason);
        }
    }

    private static function fetchFailed(string $url, string $reason): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::FetchFailed,
            "Downloading the compiler binary from '" . PrintableUrl::of($url) . "' {$reason}; nothing is installed.",
            self::FETCH_FIX,
        );
    }
}
