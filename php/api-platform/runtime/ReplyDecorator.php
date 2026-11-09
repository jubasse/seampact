<?php

declare(strict_types=1);

namespace Seampact\ApiPlatform\Runtime;

use ApiPlatform\Metadata\Operation;
use ApiPlatform\State\ProcessorInterface;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\Replies;
use Symfony\Component\HttpFoundation\Request;

/**
 * The base of each api's generated decorator of `api_platform.state_processor.main` (ADR 0029 "The reply path"). It sits
 * between API Platform's write step and its serialize step, turns a generated result of its api into the contract reply
 * with the boundary's own writer, and returns that `Response`, which API Platform's serialize and respond steps pass
 * through. Any other value goes to the inner processor untouched.
 *
 * @implements ProcessorInterface<mixed, mixed>
 */
abstract class ReplyDecorator implements ProcessorInterface
{
    /**
     * @param ProcessorInterface<mixed, mixed> $inner
     */
    public function __construct(private readonly ProcessorInterface $inner)
    {
    }

    /** The generated contract class of the api. */
    abstract protected function contractClass(): string;

    /** The id of the api this decorator writes replies for. */
    abstract protected function apiId(): string;

    /**
     * @param array<string, mixed> $uriVariables
     * @param array<string, mixed> $context
     */
    public function process(mixed $data, Operation $operation, array $uriVariables = [], array $context = []): mixed
    {
        $request = $context['request'] ?? null;
        if ($request instanceof Request && is_object($data) && ApiContract::of($this->contractClass())->resultOf($data) !== null) {
            return Replies::result($request, $this->apiId(), $data);
        }

        return $this->inner->process($data, $operation, $uriVariables, $context);
    }
}
