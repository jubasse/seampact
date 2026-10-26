<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * The role of a native layer's refusal, read from the exception Laravel's pipeline set on the reply it rendered
 * (`$response->exception`): authentication, authorization, CSRF, throttle, post size and maintenance. Classes are
 * named as strings, so an app without one of the packages still loads this map.
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
    private const SERVICE_UNAVAILABLE = 503;
    private const SERVICE_UNAVAILABLE_ROLE = 'serviceUnavailable';
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

        $isHttpException = $exception instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

        return $isHttpException && $exception->getStatusCode() === self::SERVICE_UNAVAILABLE ? self::SERVICE_UNAVAILABLE_ROLE : null;
    }
}
