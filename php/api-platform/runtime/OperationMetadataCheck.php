<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Runtime;

use ApiPlatform\Metadata\HttpOperation;
use ApiPlatform\Metadata\Resource\Factory\ResourceMetadataCollectionFactoryInterface;
use Seampact\ApiPlatform\OperationSwitches;
use Symfony\Component\DependencyInjection\Attribute\Exclude;
use Symfony\Component\HttpKernel\CacheWarmer\CacheWarmerInterface;

/**
 * The metadata part of the api's boot check (ADR 0029 "The boot check"), run by `cache:warmup`: API Platform's final
 * metadata of each generated resource, as an app's metadata extension left it, must keep every switch that turns off
 * API Platform's own request handling, the generated processor and no provider, and set neither security expression
 * that needs a denormalized object. Every problem is listed at once, then thrown.
 */
#[Exclude]
final class OperationMetadataCheck implements CacheWarmerInterface
{
    private const SWITCH_READERS = [
        'read' => 'canRead',
        'write' => 'canWrite',
        'contentNegotiation' => 'canNegotiateContent',
        'deserialize' => 'canDeserialize',
        'validate' => 'canValidate',
    ];

    /**
     * @param list<class-string> $resourceClasses the api's generated resources
     * @param array<string, class-string> $processors each operation id and its generated processor
     */
    public function __construct(
        private readonly ResourceMetadataCollectionFactoryInterface $metadata,
        private readonly string $api,
        private readonly array $resourceClasses,
        private readonly array $processors,
    ) {
    }

    public function isOptional(): bool
    {
        return false;
    }

    public function warmUp(string $cacheDir, ?string $buildDir = null): array
    {
        $problems = [];
        foreach ($this->resourceClasses as $resourceClass) {
            foreach ($this->metadata->create($resourceClass) as $resource) {
                foreach ($resource->getOperations() ?? [] as $operation) {
                    $problems = [...$problems, ...$this->problemsOf($operation)];
                }
            }
        }

        if ($problems !== []) {
            throw new \LogicException("seampact: the api '{$this->api}' cannot start:\n- " . implode("\n- ", $problems));
        }

        return [];
    }

    /** @return list<string> */
    private function problemsOf(object $operation): array
    {
        if (!$operation instanceof HttpOperation) {
            return [];
        }

        $operationId = ($operation->getDefaults() ?? [])[OperationSwitches::OPERATION_DEFAULT] ?? null;
        $processor = is_string($operationId) ? ($this->processors[$operationId] ?? null) : null;
        if ($processor === null) {
            return [];
        }

        $problems = [];
        $name = $operation->getName();
        foreach (OperationSwitches::FLAGS as $flag => $expected) {
            $actual = $operation->{self::SWITCH_READERS[$flag]}();
            if ($actual !== $expected) {
                $problems[] = "the operation '{$name}' sets {$flag}: " . var_export($actual, true) . ", not " . var_export($expected, true) . ': the boundary reads, negotiates, deserializes and validates a contract operation, so remove the change';
            }
        }

        foreach (OperationSwitches::EXTRA_PROPERTIES as $key => $expected) {
            if (($operation->getExtraProperties()[$key] ?? null) !== $expected) {
                $problems[] = "the operation '{$name}' does not set the extra property {$key}: remove the change that dropped it";
            }
        }

        foreach (['securityPostDenormalize' => $operation->getSecurityPostDenormalize(), 'securityPostValidation' => $operation->getSecurityPostValidation()] as $property => $expression) {
            if ($expression !== null) {
                $problems[] = "the operation '{$name}' sets {$property}, which needs the object API Platform's deserialize would build: use security, which runs before the handler";
            }
        }

        if ($operation->getProcessor() !== $processor) {
            $problems[] = "the operation '{$name}' has another processor than its generated {$processor}: remove the change";
        }

        if ($operation->getProvider() !== null) {
            $problems[] = "the operation '{$name}' sets a provider: the boundary reads the request, so remove it";
        }

        return $problems;
    }
}
