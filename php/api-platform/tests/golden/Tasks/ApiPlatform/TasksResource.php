<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\Link;
use ApiPlatform\Metadata\Post;

/**
 * The API Platform resource of the contract's 'Task' operations; API Platform routes them, the boundary serves them.
 */
#[ApiResource(
    shortName: 'Task',
    operations: [
        new Post(
            uriTemplate: '/v1/channels/{channelId}/tasks/{taskId}/archive',
            name: 'seampact.tasks.archiveTask',
            defaults: ['_seampact_operation' => 'archiveTask'],
            uriVariables: ['channelId' => new Link(parameterName: 'channelId', fromClass: TasksResource::class, identifiers: []), 'taskId' => new Link(parameterName: 'taskId', fromClass: TasksResource::class, identifiers: [])],
            read: false,
            write: true,
            contentNegotiation: false,
            deserialize: false,
            validate: false,
            extraProperties: ['_api_disable_swagger_provider' => true],
            processor: ArchiveTaskProcessor::class,
        ),
        new Get(
            uriTemplate: '/v1/channels/{channelId}/tasks/{taskId}',
            name: 'seampact.tasks.getTask',
            defaults: ['_seampact_operation' => 'getTask'],
            uriVariables: ['channelId' => new Link(parameterName: 'channelId', fromClass: TasksResource::class, identifiers: []), 'taskId' => new Link(parameterName: 'taskId', fromClass: TasksResource::class, identifiers: [])],
            read: false,
            write: true,
            contentNegotiation: false,
            deserialize: false,
            validate: false,
            extraProperties: ['_api_disable_swagger_provider' => true],
            processor: GetTaskProcessor::class,
        ),
        new Post(
            uriTemplate: '/v1/channels/{channelId}/tasks/batch',
            name: 'seampact.tasks.getTasksBatch',
            defaults: ['_seampact_operation' => 'getTasksBatch'],
            uriVariables: ['channelId' => new Link(parameterName: 'channelId', fromClass: TasksResource::class, identifiers: [])],
            read: false,
            write: true,
            contentNegotiation: false,
            deserialize: false,
            validate: false,
            extraProperties: ['_api_disable_swagger_provider' => true],
            processor: GetTasksBatchProcessor::class,
        ),
    ],
)]
final class TasksResource
{
}
