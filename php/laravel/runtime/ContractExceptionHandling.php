<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;

/**
 * What the api asks of Laravel's exception handler: a contract refusal and a replayed reply are answers, never reported, and an
 * `AuthenticationException` on a contract route renders a bare 401, which the boundary maps to `unauthenticated`,
 * where Laravel would redirect a browser `Accept` to `login`, or answer 500 when no such route exists. The boot check
 * refuses a handler without `renderable`.
 */
final class ContractExceptionHandling
{
    private const UNAUTHENTICATED_STATUS = 401;

    private function __construct()
    {
    }

    public static function register(ExceptionHandler $handler, string $api): void
    {
        if (method_exists($handler, 'dontReport')) {
            $handler->dontReport([ContractRefusal::class, ReplayedReply::class]);
        }

        if (method_exists($handler, 'renderable')) {
            $handler->renderable(static function (AuthenticationException $exception, Request $request) use ($api): ?Response {
                return BoundaryState::of($request, $api) === null ? null : new Response('', self::UNAUTHENTICATED_STATUS);
            });
        }
    }
}
