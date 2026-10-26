<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Http\Request;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\ResolvedScope;
use Symfony\Component\HttpFoundation\Response;

/**
 * What the boundary knows of one contract request, in a request attribute named after the api: the operation the raw
 * path matched, its raw path parameters, the held body, the principal and scopes steps 2 to 5 resolved, and the
 * replies the boundary wrote, with the status, body and ETag it wrote them with.
 */
final class BoundaryState
{
    public ?object $principal = null;
    /** @var list<ResolvedScope> */
    public array $scopes = [];
    public ?object $contractInput = null;
    /** The body decoded with its objects preserved; null when the request carries none. */
    public mixed $body = null;
    /** @var \WeakMap<Response, array{int, string, ?string}> */
    private \WeakMap $authored;

    /** @param array<string, string> $rawParameters */
    public function __construct(
        public readonly ApiContract $contract,
        public readonly string $operationId,
        public readonly array $rawParameters,
        public readonly RequestView $view,
    ) {
        $this->authored = new \WeakMap();
    }

    public static function attributeName(string $api): string
    {
        return "seampact.{$api}.state";
    }

    public static function of(Request $request, string $api): ?self
    {
        $state = $request->attributes->get(self::attributeName($api));

        return $state instanceof self ? $state : null;
    }

    /** @throws ContractBypassedException the boundary middleware did not run for `$request` */
    public static function required(Request $request, string $api): self
    {
        return self::of($request, $api) ?? throw new ContractBypassedException(
            "A contract reply of api '{$api}' was built for a request the boundary middleware did not match. "
            . 'Serve the operation only through its generated route, with the boundary middleware installed.',
        );
    }

    public function author(Response $response): Response
    {
        $content = $response->getContent();
        $this->authored[$response] = [$response->getStatusCode(), $content === false ? '' : $content, $response->headers->get('ETag')];

        return $response;
    }

    /** Whether the boundary wrote `$response` with its current status and body. */
    public function authored(Response $response): bool
    {
        $written = $this->authored[$response] ?? null;
        if ($written === null) {
            return false;
        }
        $content = $response->getContent();

        return $written[0] === $response->getStatusCode() && $written[1] === ($content === false ? '' : $content);
    }

    /** The ETag the boundary wrote on `$response`, null when it wrote none. */
    public function authoredEtag(Response $response): ?string
    {
        return ($this->authored[$response] ?? null)[2] ?? null;
    }
}
