<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use Seampact\ApiPlatform\Runtime\OperationProcessor;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\HealthInput;
use Seampact\Golden\Tasks\Symfony\TasksInputResolver;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * Runs the handler of operation 'health' for API Platform, on the input the boundary checked.
 */
#[Exclude]
final class HealthProcessor extends OperationProcessor
{
    public function __construct(
        private readonly AppEndpoints $handler,
    ) {
    }

    protected function operationId(): string
    {
        return 'health';
    }

    protected function apiId(): string
    {
        return 'tasks';
    }

    protected function inputAttribute(): string
    {
        return TasksInputResolver::INPUT_ATTRIBUTE;
    }

    protected function handle(object $input): object
    {
        if (!$input instanceof HealthInput) {
            throw new ContractBypassedException("The processor of operation 'health' got no checked input of that operation.");
        }

        return $this->handler->health($input);
    }
}
