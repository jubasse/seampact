<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\Link;

/**
 * The API Platform resource of the contract's 'Channel' operations; API Platform routes them, the boundary serves them.
 */
#[ApiResource(
    shortName: 'Channel',
    operations: [
        new Get(
            uriTemplate: '/v1/channels/{channelId}',
            name: 'seampact.tasks.getChannel',
            defaults: ['_seampact_operation' => 'getChannel'],
            uriVariables: ['channelId' => new Link(parameterName: 'channelId', fromClass: ChannelsResource::class, identifiers: [])],
            read: false,
            write: true,
            contentNegotiation: false,
            deserialize: false,
            validate: false,
            extraProperties: ['_api_disable_swagger_provider' => true],
            processor: GetChannelProcessor::class,
        ),
    ],
)]
final class ChannelsResource
{
}
