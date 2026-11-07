<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\AppEndpoints;
use App\Generated\Tasks\HealthResponse200;
use App\Generated\Tasks\HealthResult;
use App\Generated\Tasks\HealthRequest;
use App\Generated\Tasks\Schemas\Health;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class AppController implements AppEndpoints
{
    public function health(HealthRequest $request): HealthResult
    {
        return ScriptedAnswers::answer('health', 200, static fn (array $body): HealthResult => new HealthResponse200(new Health(SampleData::text($body, 'status'))))
            ?? new HealthResponse200(new Health('ok'));
    }
}
