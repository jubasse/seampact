<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\Link;

/**
 * The API Platform resource of the contract's 'Draft' operations; API Platform routes them, the boundary serves them.
 */
#[ApiResource(
    shortName: 'Draft',
    operations: [
        new Get(
            uriTemplate: '/v1/me/drafts/{draftId}',
            name: 'seampact.tasks.getDraft',
            defaults: ['_seampact_operation' => 'getDraft'],
            uriVariables: ['draftId' => new Link(parameterName: 'draftId', fromClass: DraftsResource::class, identifiers: [])],
            read: false,
            write: true,
            contentNegotiation: false,
            deserialize: false,
            validate: false,
            extraProperties: ['_api_disable_swagger_provider' => true],
            processor: GetDraftProcessor::class,
        ),
    ],
)]
final class DraftsResource
{
}
