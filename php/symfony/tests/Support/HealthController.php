<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\HealthInput;
use Seampact\Golden\Tasks\HealthResult;

/** The app's one implementation of the golden `AppEndpoints`, for the controller pass. */
final class HealthController implements AppEndpoints
{
    public function health(HealthInput $input): HealthResult
    {
        throw new \LogicException('The test controller is never called.');
    }
}
