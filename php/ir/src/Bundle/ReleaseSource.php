<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** A release asset: the bundle tarball downloaded over HTTPS. */
final readonly class ReleaseSource implements BundleSource
{
    public function __construct(public string $url, private ?string $integrity)
    {
    }

    public function integrity(): ?string
    {
        return $this->integrity;
    }

    public function describe(): string
    {
        return "release '" . PrintableUrl::of($this->url) . "'";
    }
}
