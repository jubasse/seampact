<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * The role of a native layer's refusal, read from the exception Laravel's pipeline set on the reply it rendered
 * (`$response->exception`): authentication, authorization, CSRF, throttle, post size and maintenance. Classes are
 * named as strings, so an app without one of the packages still loads this map. An HTTP exception with no mapped
 * class (`abort(401)`, `abort(403)`, `abort(429)` from a handler or an app middleware, or maintenance's 503) takes
 * the role of its status.
 */
final class ExceptionRoles
{
    private const ROLES = [
        'Illuminate\\Auth\\AuthenticationException' => 'unauthenticated',
        'Illuminate\\Auth\\Access\\AuthorizationException' => 'forbidden',
        'Illuminate\\Session\\TokenMismatchException' => 'csrfInvalid',
        'Illuminate\\Http\\Exceptions\\OriginMismatchException' => 'csrfInvalid',
        'Illuminate\\Http\\Exceptions\\ThrottleRequestsException' => 'rateLimited',
        'Illuminate\\Http\\Exceptions\\PostTooLargeException' => 'payloadTooLarge',
    ];
    private const STATUS_ROLES = [
        401 => 'unauthenticated',
        403 => 'forbidden',
        429 => 'rateLimited',
        503 => 'serviceUnavailable',
    ];
    /** The headers a mapped refusal keeps from the reply Laravel rendered. */
    public const KEPT_HEADERS = ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'];

    private function __construct()
    {
    }

    public static function roleOf(\Throwable $exception): ?string
    {
        foreach (self::ROLES as $class => $role) {
            if ($exception instanceof $class) {
                return $role;
            }
        }

        if (!$exception instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface) {
            return null;
        }

        return self::STATUS_ROLES[$exception->getStatusCode()] ?? null;
    }
}
