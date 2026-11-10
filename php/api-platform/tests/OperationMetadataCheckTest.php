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
        $changed = self::operation(['read' => true, 'write' => false, 'deserialize' => true, 'validate' => true, 'contentNegotiation' => true, 'securityPostDenormalize' => 'is_granted("ROLE_USER")', 'securityPostValidation' => 'is_granted("ROLE_USER")', 'extraProperties' => [], 'provider' => 'App\\Provider']);

        try {
            self::check($changed)->warmUp('/tmp');
            self::fail('A changed switch passed the check.');
        } catch (\LogicException $failure) {
            self::assertStringContainsString("the api 'tasks' cannot start", $failure->getMessage());
            self::assertStringContainsString('sets read: true, not false', $failure->getMessage());
            self::assertStringContainsString('sets write: false, not true', $failure->getMessage());
            self::assertStringContainsString('sets deserialize: true, not false', $failure->getMessage());
            self::assertStringContainsString('sets validate: true, not false', $failure->getMessage());
            self::assertStringContainsString('sets contentNegotiation: true, not false', $failure->getMessage());
            self::assertStringContainsString('does not set the extra property _api_disable_swagger_provider', $failure->getMessage());
            self::assertStringContainsString('sets securityPostValidation', $failure->getMessage());
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

    public function testATaggedInputRulesServiceIsRefusedByName(): void
    {
        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('input.rules.unsupported: ' . \ArrayObject::class . ' is tagged as app input rules');

        self::check(self::operation([]), [new \ArrayObject()])->warmUp('/tmp');
    }

    /** @param array{read?: bool, write?: bool, deserialize?: bool, validate?: bool, contentNegotiation?: bool, securityPostDenormalize?: string, securityPostValidation?: string, extraProperties?: array<string, bool>, provider?: string, processor?: string} $changes */
    private static function operation(array $changes): Get
    {
        return new Get(
            name: 'seampact.tasks.getTask',
            defaults: [OperationSwitches::OPERATION_DEFAULT => 'getTask'],
            read: $changes['read'] ?? false,
            write: $changes['write'] ?? true,
            contentNegotiation: $changes['contentNegotiation'] ?? false,
            deserialize: $changes['deserialize'] ?? false,
            validate: $changes['validate'] ?? false,
            extraProperties: $changes['extraProperties'] ?? OperationSwitches::EXTRA_PROPERTIES,
            securityPostDenormalize: $changes['securityPostDenormalize'] ?? null,
            securityPostValidation: $changes['securityPostValidation'] ?? null,
            provider: $changes['provider'] ?? null,
            processor: $changes['processor'] ?? self::PROCESSOR,
        );
    }

    /** @param list<object> $inputRules */
    private static function check(Get $operation, array $inputRules = []): OperationMetadataCheck
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

        return new OperationMetadataCheck($factory, 'tasks', [\stdClass::class], ['getTask' => self::PROCESSOR], $inputRules);
    }
}
