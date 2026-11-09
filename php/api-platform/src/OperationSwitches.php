<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform;

/**
 * The switches every contract operation sets on its API Platform operation (ADR 0029 "The check order"), which turn
 * off API Platform's own request handling: the boundary reads, negotiates, deserializes and validates, and the
 * generated processor runs for a safe operation too.
 */
final class OperationSwitches
{
    /** @var array<string, bool> */
    public const FLAGS = [
        'read' => false,
        'write' => true,
        'contentNegotiation' => false,
        'deserialize' => false,
        'validate' => false,
    ];

    /** Without negotiation the request format is `html`, and API Platform's Swagger UI would replace the operation. */
    public const EXTRA_PROPERTIES = ['_api_disable_swagger_provider' => true];

    public const OPERATION_DEFAULT = '_seampact_operation';

    /** The API Platform operation class of each contract method. */
    public const OPERATION_CLASSES = [
        'get' => 'ApiPlatform\\Metadata\\Get',
        'post' => 'ApiPlatform\\Metadata\\Post',
        'put' => 'ApiPlatform\\Metadata\\Put',
        'patch' => 'ApiPlatform\\Metadata\\Patch',
        'delete' => 'ApiPlatform\\Metadata\\Delete',
    ];

    private function __construct()
    {
    }
}
