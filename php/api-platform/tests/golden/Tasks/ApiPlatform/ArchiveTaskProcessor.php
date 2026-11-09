<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use Seampact\ApiPlatform\Runtime\OperationProcessor;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Golden\Tasks\ArchiveTaskInput;
use Seampact\Golden\Tasks\Symfony\TasksInputResolver;
use Seampact\Golden\Tasks\TasksEndpoints;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * Runs the handler of operation 'archiveTask' for API Platform, on the input the boundary checked.
 */
#[Exclude]
final class ArchiveTaskProcessor extends OperationProcessor
{
    public function __construct(
        private readonly TasksEndpoints $handler,
    ) {
    }

    protected function operationId(): string
    {
        return 'archiveTask';
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
        if (!$input instanceof ArchiveTaskInput) {
            throw new ContractBypassedException("The processor of operation 'archiveTask' got no checked input of that operation.");
        }

        return $this->handler->archiveTask($input);
    }
}
