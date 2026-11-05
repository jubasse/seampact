<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Https\HttpsDownload;

/**
 * The release-asset channel, as `fetch-release.ts`: the bundle tarball downloaded over HTTPS by `HttpsDownload`, which
 * stops at the archive cap; the archive reader then checks the bytes. A `caFile` replaces the system's certificate
 * authorities.
 */
final readonly class ReleaseFetch
{
    public const DEADLINE_SECONDS = 60.0;

    private const RELEASE_FIX = 'Check the release URL and that the asset is reachable over HTTPS, then run again.';

    public function __construct(private float $deadlineSeconds = self::DEADLINE_SECONDS, private ?string $caFile = null)
    {
    }

    /** Why the source's URL cannot be downloaded from, before any request or cache read. */
    public static function sourceProblem(ReleaseSource $source): ?BundleFailure
    {
        if (HttpsDownload::isHttpsUrl($source->url)) {
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

        $body = '';
        $failure = (new HttpsDownload($this->deadlineSeconds, $this->caFile))->stream(
            $source->url,
            BundleLayout::ARCHIVE_BYTES_MAX,
            static function (string $chunk) use (&$body): void {
                $body .= $chunk;
            },
        );

        if ($failure === null) {
            return $body;
        }

        if ($failure->bytesReceivedOverCap !== null) {
            return new BundleFailure(
                BundleFailureCode::ArchiveTooLarge,
                'The release tarball holds more than ' . BundleLayout::ARCHIVE_BYTES_MAX . " bytes ({$failure->bytesReceivedOverCap} received), over the cap.",
                BundleLayout::NOT_A_BUNDLE_FIX,
                null,
                (string) BundleLayout::ARCHIVE_BYTES_MAX,
            );
        }

        return self::failed($failure->url, $failure->reason);
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
