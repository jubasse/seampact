<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** What a target says of each pending form: when it arrives, or null when this release generates it. */
interface FormReleases
{
    public function arrivalOf(PendingForm $form): ?FormArrival;
}
