<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\ApiPlatform;

use Seampact\ApiPlatform\Runtime\OperationProcessor;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Golden\Tasks\ChannelsEndpoints;
use Seampact\Golden\Tasks\GetChannelInput;
use Seampact\Golden\Tasks\Symfony\TasksInputResolver;
use Symfony\Component\DependencyInjection\Attribute\Exclude;

/**
 * Runs the handler of operation 'getChannel' for API Platform, on the input the boundary checked.
 */
#[Exclude]
final class GetChannelProcessor extends OperationProcessor
{
    public function __construct(
        private readonly ChannelsEndpoints $handler,
    ) {
    }

    protected function operationId(): string
    {
        return 'getChannel';
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
        if (!$input instanceof GetChannelInput) {
            throw new ContractBypassedException("The processor of operation 'getChannel' got no checked input of that operation.");
        }

        return $this->handler->getChannel($input);
    }
}
