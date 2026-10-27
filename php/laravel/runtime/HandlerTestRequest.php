<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Container\Container;
use Illuminate\Http\Request;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\RawTarget;
use Seampact\Hooks\ResolvedScope;

/**
 * The FormRequest a generated `forTest()` builds, for a unit test that calls a handler directly: it holds the boundary
 * state of an admitted request, with the input, the principal and the scopes the test gives, so `contractInput()`,
 * `principal()` and `scopes()` read them. It carries no access mark, so the boundary never serves it.
 */
final class HandlerTestRequest
{
    private function __construct()
    {
    }

    /**
     * @template T of Request
     * @param T $request a FormRequest the boundary never saw
     * @param class-string $contractClass the api's generated contract class
     * @param list<ResolvedScope> $scopes outermost first, as the operation declares them
     * @return T
     */
    public static function admitted(Request $request, string $contractClass, string $operationId, object $input, ?object $principal, array $scopes): Request
    {
        $contract = ApiContract::of($contractClass);
        // The handler's accessors read no hook, so the state's lookup is an empty container's.
        $state = new BoundaryState($contract, $operationId, [], RawTarget::view($request), new Hooks(new Container()));
        $state->contractInput = $input;
        $state->principal = $principal;
        $state->scopes = $scopes;
        $state->admitted = true;
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        return $request;
    }
}
