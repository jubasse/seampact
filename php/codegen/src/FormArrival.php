<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** When a target brings a form it does not generate yet: a named release of the target, or a `Delivery`. */
final readonly class FormArrival
{
    private function __construct(public ?string $release, public ?Delivery $delivery)
    {
    }

    /** A named release of the target, such as 'laravel-3'. */
    public static function inRelease(string $release): self
    {
        return new self($release, null);
    }

    public static function later(Delivery $delivery): self
    {
        return new self(null, $delivery);
    }
}
