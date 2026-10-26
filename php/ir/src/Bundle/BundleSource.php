<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * Where a bundle comes from (ADR 0011 "Channels"), with the `integrity` the config pins; a missing pin fails the
 * check and prints the value to pin.
 */
interface BundleSource
{
    public function integrity(): ?string;

    /** The source as the config writes it, for messages, with no credential of its URL. */
    public function describe(): string;
}
