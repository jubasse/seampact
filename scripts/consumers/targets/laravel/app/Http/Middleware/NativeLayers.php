<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * The native layers the suite reaches on identity routes, chosen by the `X-Suite-Native-Layer` header: `sanctum` runs
 * Laravel's `auth:sanctum` middleware, which finds no user, and `abort-401`, `abort-403` and `abort-429` call
 * `abort()` as an app middleware would. Without the header the request passes.
 */
final class NativeLayers
{
    public const HEADER = 'X-Suite-Native-Layer';
    private const SANCTUM = 'sanctum';
    private const ABORT_PREFIX = 'abort-';

    public function __construct(private readonly Authenticate $authenticate)
    {
    }

    public function handle(Request $request, \Closure $next): Response
    {
        $layer = $request->headers->get(self::HEADER);
        if ($layer === self::SANCTUM) {
            return $this->authenticate->handle($request, $next, self::SANCTUM);
        }

        if (is_string($layer) && str_starts_with($layer, self::ABORT_PREFIX)) {
            abort((int) substr($layer, strlen(self::ABORT_PREFIX)));
        }

        return $next($request);
    }
}
