<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\AppEndpoints;
use App\Generated\Tasks\HealthInput;
use App\Generated\Tasks\HealthResponse200;
use App\Generated\Tasks\HealthResult;
use App\Generated\Tasks\Schemas\Health;
use App\Generated\Tasks\Symfony\Runtime\SeampactOperation;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class AppController implements AppEndpoints
{
    #[SeampactOperation('health')]
    public function health(HealthInput $input): HealthResult
    {
        return ScriptedAnswers::answer('health', 200, static fn (array $body): HealthResult => new HealthResponse200(new Health(SampleData::text($body, 'status'))))
            ?? new HealthResponse200(new Health('ok'));
    }
}
