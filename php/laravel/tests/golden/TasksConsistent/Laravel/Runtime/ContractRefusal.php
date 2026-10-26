<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A contract error the boundary answers before the handler, with one of the operation's declared codes and its
 * params: thrown by the access middleware and the FormRequest, rendered by its own `render()`, which Laravel's
 * handler calls before any render callback of the app.
 */
final class ContractRefusal extends \RuntimeException
{
    /** @param array<string, string> $headers */
    public function __construct(
        public readonly string $api,
        public readonly string $contractCode,
        public readonly ?\stdClass $params = null,
        public readonly array $headers = [],
    ) {
        parent::__construct("seampact: the request is refused as '{$contractCode}'.");
    }

    public function render(Request $request): Response
    {
        $state = BoundaryState::required($request, $this->api);
        $reply = Replies::error($state->contract, $state->operationId, $this->contractCode, $this->params);
        $reply->headers->add($this->headers);

        return $state->author($reply);
    }
}
