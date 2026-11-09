<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use Seampact\ApiPlatform\Runtime\OperationProcessor;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Golden\Tasks\DraftsEndpoints;
use Seampact\Golden\Tasks\GetDraftInput;
use Seampact\Golden\Tasks\Symfony\TasksInputResolver;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * Runs the handler of operation 'getDraft' for API Platform, on the input the boundary checked.
 */
#[Exclude]
final class GetDraftProcessor extends OperationProcessor
{
    public function __construct(
        private readonly DraftsEndpoints $handler,
    ) {
    }

    protected function operationId(): string
    {
        return 'getDraft';
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
        if (!$input instanceof GetDraftInput) {
            throw new ContractBypassedException("The processor of operation 'getDraft' got no checked input of that operation.");
        }

        return $this->handler->getDraft($input);
    }
}
