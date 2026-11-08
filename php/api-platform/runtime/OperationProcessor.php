<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Runtime;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Symfony\Component\HttpFoundation\Request;

/**
 * The base of each operation's generated processor (ADR 0029 "Placement"): it runs only for the request the boundary
 * admitted for its own operation, reads the typed input the boundary stored, and returns what the developer's handler
 * returns, a generated result that the reply path writes. Any other request is a bypass of the contract and is refused.
 *
 * @implements ProcessorInterface<mixed, object>
 */
abstract class OperationProcessor implements ProcessorInterface
{
    /** The operation id this processor serves. */
    abstract protected function operationId(): string;

    /** The id of the api the operation belongs to. */
    abstract protected function apiId(): string;

    /** The request attribute the boundary stores the typed input under. */
    abstract protected function inputAttribute(): string;

    /** Calls the developer's handler with the checked input. */
    abstract protected function handle(object $input): object;

    /**
     * @param array<string, mixed> $uriVariables
     * @param array<string, mixed> $context
     */
    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): object
    {
        $request = $context['request'] ?? null;
        if (!$request instanceof Request) {
            throw new ContractBypassedException("The processor of operation '{$this->operationId()}' of api '{$this->apiId()}' ran outside an HTTP request.");
        }

        $state = BoundaryState::of($request, $this->apiId());
        if ($state === null || !$state->admitted || $state->operationId !== $this->operationId()) {
            throw new ContractBypassedException("The processor of operation '{$this->operationId()}' of api '{$this->apiId()}' ran for a request the boundary did not admit for that operation; serve it only through its generated route.");
        }

        $input = $request->attributes->get($this->inputAttribute());
        if (!is_object($input)) {
            throw new ContractBypassedException("The processor of operation '{$this->operationId()}' of api '{$this->apiId()}' found no checked input on the request.");
        }

        return $this->handle($input);
    }
}
