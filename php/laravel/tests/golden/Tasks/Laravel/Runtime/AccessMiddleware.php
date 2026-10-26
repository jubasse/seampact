<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Request;

/**
 * The api's route middleware, placed before `SubstituteBindings`: it checks that the route Laravel chose carries the
 * operation the raw path matched, runs steps 2 to 5, and marks the request with the operation id, which the
 * operation's FormRequest requires.
 */
abstract class AccessMiddleware
{
    private const NOT_FOUND_ROLE = 'notFound';

    public function __construct(protected readonly Application $app)
    {
    }

    /** The generated contract class of the api. */
    abstract protected function contractClass(): string;

    public function handle(Request $request, \Closure $next): mixed
    {
        $contract = ApiContract::of($this->contractClass());
        $state = BoundaryState::required($request, $contract->api);
        $route = Services::route($request);
        if ($route === null || $route->getName() !== $contract->routeName($state->operationId)) {
            throw AccessSteps::roleRefusal($state, self::NOT_FOUND_ROLE);
        }

        try {
            AccessSteps::run($this->app, $request, $state);
        } catch (\Throwable $failure) {
            // A refusal keeps its role, read from the role map the boundary maps native exceptions with (ADR 0023).
            if ($failure instanceof ContractRefusal || ExceptionRoles::roleOf($failure) !== null) {
                throw $failure;
            }

            throw new BoundaryFailure($failure);
        }
        $state->admitted = true;
        $request->attributes->set(BoundaryMark::attributeName($contract->api), $state->operationId);

        return $next($request);
    }
}
