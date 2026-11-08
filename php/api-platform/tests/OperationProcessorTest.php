<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Tests;

use ApiPlatform\Metadata\Get;
use PHPUnit\Framework\TestCase;
use Seampact\ApiPlatform\Runtime\OperationProcessor;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Symfony\Component\HttpFoundation\Request;

/** The bypass check the generated processors carry now that no handler method holds the operation attribute. */
final class OperationProcessorTest extends TestCase
{
    public function testAProcessorRefusesAContextWithoutARequest(): void
    {
        $this->expectException(ContractBypassedException::class);
        $this->expectExceptionMessage("operation 'getTask' of api 'tasks' ran outside an HTTP request");

        self::processor()->process(null, new Get());
    }

    public function testAProcessorRefusesARequestTheBoundaryDidNotAdmit(): void
    {
        $this->expectException(ContractBypassedException::class);
        $this->expectExceptionMessage('the boundary did not admit for that operation');

        self::processor()->process(null, new Get(), [], ['request' => Request::create('/v1/tasks')]);
    }

    private static function processor(): OperationProcessor
    {
        return new class extends OperationProcessor {
            protected function operationId(): string
            {
                return 'getTask';
            }

            protected function apiId(): string
            {
                return 'tasks';
            }

            protected function inputAttribute(): string
            {
                return '_input';
            }

            protected function handle(object $input): object
            {
                return $input;
            }
        };
    }
}
