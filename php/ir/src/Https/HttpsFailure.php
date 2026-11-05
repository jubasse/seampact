<?php

declare(strict_types=1);

namespace Seampact\Ir\Https;

/**
 * Why a download stopped: the URL that failed (after redirects), what happened to it, and, for a body over the cap,
 * the bytes received so far. The URL is raw: each channel prints it without its userinfo and query.
 */
final readonly class HttpsFailure
{
    public function __construct(public string $url, public string $reason, public ?int $bytesReceivedOverCap = null)
    {
    }
}
