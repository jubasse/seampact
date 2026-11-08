<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use ApiPlatform\Metadata\ApiResource;
use ApiPlatform\Metadata\Get;
use ApiPlatform\Metadata\Operations;
use ApiPlatform\Metadata\Resource\Factory\ResourceMetadataCollectionFactoryInterface;
use ApiPlatform\Metadata\Resource\ResourceMetadataCollection;
use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\OperationSwitches;
use Seampact\ApiPlatform\Runtime\OperationMetadataCheck;

/** The boot check's metadata part: an app's metadata extension may not undo what the generated operations switch off. */
final class OperationMetadataCheckTest extends TestCase
{
    private const PROCESSOR = \stdClass::class;

    public function testTheGeneratedMetadataPasses(): void
    {
        self::assertSame([], self::check(self::operation([]))->warmUp('/tmp'));
    }

    public function testEachChangedSwitchIsListedAtOnce(): void
    {
        $changed = self::operation(['read' => true, 'deserialize' => true, 'securityPostDenormalize' => 'is_granted("ROLE_USER")', 'provider' => 'App\\Provider']);

        try {
            self::check($changed)->warmUp('/tmp');
            self::fail('A changed switch passed the check.');
        } catch (\LogicException $failure) {
            self::assertStringContainsString("the api 'tasks' cannot start", $failure->getMessage());
            self::assertStringContainsString('sets read: true, not false', $failure->getMessage());
            self::assertStringContainsString('sets deserialize: true, not false', $failure->getMessage());
            self::assertStringContainsString('sets securityPostDenormalize', $failure->getMessage());
            self::assertStringContainsString('sets a provider', $failure->getMessage());
        }
    }

    public function testAnotherProcessorIsRefused(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('has another processor than its generated ' . self::PROCESSOR);

        self::check(self::operation(['processor' => 'App\\Other']))->warmUp('/tmp');
    }

    /** @param array{read?: bool, deserialize?: bool, securityPostDenormalize?: string, provider?: string, processor?: string} $changes */
    private static function operation(array $changes): Get
    {
        return new Get(
            name: 'seampact.tasks.getTask',
            defaults: [OperationSwitches::OPERATION_DEFAULT => 'getTask'],
            read: $changes['read'] ?? false,
            write: true,
            contentNegotiation: false,
            deserialize: $changes['deserialize'] ?? false,
            validate: false,
            extraProperties: OperationSwitches::EXTRA_PROPERTIES,
            securityPostDenormalize: $changes['securityPostDenormalize'] ?? null,
            provider: $changes['provider'] ?? null,
            processor: $changes['processor'] ?? self::PROCESSOR,
        );
    }

    private static function check(Get $operation): OperationMetadataCheck
    {
        $factory = new class ($operation) implements ResourceMetadataCollectionFactoryInterface {
            public function __construct(private readonly Get $operation)
            {
            }

            public function create(string $resourceClass): ResourceMetadataCollection
            {
                $operations = new Operations([$this->operation->getName() => $this->operation]);

                return new ResourceMetadataCollection($resourceClass, [(new ApiResource())->withOperations($operations)]);
            }
        };

        return new OperationMetadataCheck($factory, 'tasks', [\stdClass::class], ['getTask' => self::PROCESSOR]);
    }
}
