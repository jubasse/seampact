<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\FrameworkRefusal;
use Symfony\Component\HttpFoundation\Response;

/**
 * The role of a native layer's refusal (ADR 0024 "Exceptions on contract routes"), read from the first exception of
 * the request and the reply Symfony wrote for it, first matching row wins: throttling, CSRF, authentication, an access
 * denial answered by the firewall's entry point (a 401 or a redirect) or with a 403, then an HTTP exception that a
 * handler, an app listener or a value resolver throws (`createNotFoundException()`, a `MapEntity` miss), which takes
 * the role of its status (`createAccessDeniedException()` aside, which is an access denial). The boundary maps any HTTP
 * exception by the shared `FrameworkRefusal` rule. Classes are named as strings, so an app without SecurityBundle or
 * RateLimiter still loads this map.
 */
final class ExceptionRoles
{
    private const RATE_LIMITED = [
        'Symfony\\Component\\Security\\Core\\Exception\\TooManyLoginAttemptsAuthenticationException',
        'Symfony\\Component\\RateLimiter\\Exception\\RateLimitExceededException',
        'Symfony\\Component\\HttpKernel\\Exception\\TooManyRequestsHttpException',
    ];
    private const CSRF_INVALID = 'Symfony\\Component\\Security\\Core\\Exception\\InvalidCsrfTokenException';
    private const AUTHENTICATION = 'Symfony\\Component\\Security\\Core\\Exception\\AuthenticationException';
    private const ACCESS_DENIED = 'Symfony\\Component\\Security\\Core\\Exception\\AccessDeniedException';
    private const UNAUTHORIZED = 401;
    private const FORBIDDEN = 403;
    /** The headers a mapped refusal keeps from the reply Symfony wrote. */
    public const KEPT_HEADERS = ['Retry-After'];

    private function __construct()
    {
    }

    public static function roleOf(\Throwable $exception, Response $reply): ?string
    {
        foreach (self::RATE_LIMITED as $class) {
            if (is_a($exception, $class)) {
                return 'rateLimited';
            }
        }

        if (is_a($exception, self::CSRF_INVALID)) {
            return 'csrfInvalid';
        }

        if (is_a($exception, self::AUTHENTICATION)) {
            return 'unauthenticated';
        }

        if (!is_a($exception, self::ACCESS_DENIED)) {
            return self::statusRoleOf($exception);
        }

        $status = $reply->getStatusCode();
        if ($status === self::UNAUTHORIZED || $reply->isRedirection()) {
            return 'unauthenticated';
        }

        return $status === self::FORBIDDEN ? 'forbidden' : null;
    }

    private static function statusRoleOf(\Throwable $exception): ?string
    {
        $status = FrameworkRefusal::statusOf($exception);

        return $status === null ? null : FrameworkRefusal::roleOfStatus($status);
    }

    /** Whether `$exception` is Symfony's `AccessDeniedException`, from `access_control`, a voter or app code. */
    public static function isAccessDenial(\Throwable $exception): bool
    {
        return is_a($exception, self::ACCESS_DENIED);
    }

    /**
     * Whether `$exception` is one of the native layers' refusals or any HTTP exception, whatever reply Symfony writes
     * for it, so a hook that throws one keeps its role, and the boundary maps it rather than answering the api's 500.
     */
    public static function isNativeRefusal(\Throwable $exception): bool
    {
        return self::roleOf($exception, new Response('', self::FORBIDDEN)) !== null || FrameworkRefusal::statusOf($exception) !== null;
    }

    /** The `Retry-After` an exception carries (`getRetryAfter()`), in whole seconds from now, rounded up, never below 0. */
    public static function retryAfter(\Throwable $exception): ?string
    {
        $retryAfter = method_exists($exception, 'getRetryAfter') ? $exception->getRetryAfter() : null;
        if (!$retryAfter instanceof \DateTimeInterface) {
            return null;
        }

        $seconds = (float) $retryAfter->format('U.u') - microtime(true);

        return (string) max(0, (int) ceil($seconds));
    }
}
