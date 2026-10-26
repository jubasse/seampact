<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Auth\Access\AuthorizationException;
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
        } catch (ContractRefusal|AuthorizationException $refusal) {
            // A refusal keeps its role: Laravel's AuthorizationException maps to `forbidden` (ADR 0023).
            throw $refusal;
        } catch (\Throwable $failure) {
            throw new BoundaryFailure($failure);
        }
        $state->admitted = true;
        $request->attributes->set(BoundaryMark::attributeName($contract->api), $state->operationId);

        return $next($request);
    }
}
