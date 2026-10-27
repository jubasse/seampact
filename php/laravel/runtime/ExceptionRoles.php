<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Seampact\Codegen\Runtime\FrameworkRefusal;

/**
 * The role of a native layer's refusal, read from the exception Laravel's pipeline set on the reply it rendered
 * (`$response->exception`): authentication, authorization, CSRF, throttle, post size, a missing model
 * (`findOrFail()`) and maintenance. Classes are named as strings, so an app without one of the packages still loads
 * this map. An HTTP exception with no mapped class (`abort(404)` from a handler or an app middleware, or maintenance's
 * 503) takes the role of its status, and the boundary maps any HTTP exception by the shared `FrameworkRefusal` rule.
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
        'Illuminate\\Database\\RecordsNotFoundException' => 'notFound',
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

        return FrameworkRefusal::statusRoleOf($exception);
    }

    /** Whether the boundary maps `$exception` to a contract code: a mapped class or any HTTP exception. */
    public static function isNativeRefusal(\Throwable $exception): bool
    {
        return self::roleOf($exception) !== null || FrameworkRefusal::statusOf($exception) !== null;
    }
}
