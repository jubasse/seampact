<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\FormArrival;
use Seampact\Codegen\FormReleases;
use Seampact\Codegen\PendingForm;

/** A target that brings every pending form at one arrival, or generates them all when it is null. */
final readonly class FixedReleases implements FormReleases
{
    public function __construct(private ?FormArrival $arrival)
    {
    }

    public function arrivalOf(PendingForm $form): ?FormArrival
    {
        return $this->arrival;
    }
}
