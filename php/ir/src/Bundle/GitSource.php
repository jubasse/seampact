<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** A git tag: the bundle directory of the tag's tree, fetched with the system `git`. */
final readonly class GitSource implements BundleSource
{
    public function __construct(public string $url, public string $tag, public ?string $directory, private ?string $integrity)
    {
    }

    public function integrity(): ?string
    {
        return $this->integrity;
    }

    public function describe(): string
    {
        $inDirectory = $this->directory === null ? '' : ", directory '{$this->directory}'";

        return "git '" . PrintableUrl::of($this->url) . "' tag '{$this->tag}'{$inDirectory}";
    }
}
