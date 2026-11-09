<?php

declare(strict_types=1);

namespace App\Suite;

use ApiPlatform\Metadata\Resource\Factory\ResourceMetadataCollectionFactoryInterface;
use ApiPlatform\Metadata\Resource\ResourceMetadataCollection;
use Symfony\Component\DependencyInjection\Attribute\AsDecorator;

/**
 * The documented way an app adds API Platform's `security` to a contract operation (ADR 0029 "Native security"): a
 * decorator of the resource metadata collection factory. The expression runs after the boundary admitted the request,
 * with a null `object`, and refuses a request that carries the probe header.
 */
#[AsDecorator('api_platform.metadata.resource.metadata_collection_factory')]
final class SecurityProbeMetadata implements ResourceMetadataCollectionFactoryInterface
{
    public const PROBE_HEADER = 'x-seampact-suite-api-platform-deny';
    private const SECURED_OPERATION = 'seampact.tasks.createTask';

    public function __construct(private readonly ResourceMetadataCollectionFactoryInterface $inner)
    {
    }

    public function create(string $resourceClass): ResourceMetadataCollection
    {
        $collection = $this->inner->create($resourceClass);

        foreach ($collection as $position => $resource) {
            $operations = $resource->getOperations();
            foreach ($operations ?? [] as $name => $operation) {
                if ($name === self::SECURED_OPERATION) {
                    $operations->add($name, $operation->withSecurity("request.headers.get('" . self::PROBE_HEADER . "') != 'true'"));
                    $collection[$position] = $resource->withOperations($operations);
                }
            }
        }

        return $collection;
    }
}
