<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\Link;

/**
 * The API Platform resource of the contract's 'Health' operations; API Platform routes them, the boundary serves them.
 */
#[ApiResource(
    shortName: 'Health',
    operations: [
        new Get(
            uriTemplate: '/v1/health',
            name: 'seampact.tasks.health',
            defaults: ['_seampact_operation' => 'health'],
            read: false,
            write: true,
            contentNegotiation: false,
            deserialize: false,
            validate: false,
            extraProperties: ['_api_disable_swagger_provider' => true],
            processor: HealthProcessor::class,
        ),
    ],
)]
final class AppResource
{
}
