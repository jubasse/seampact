<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\AuthenticateSession;

/**
 * The guest redirect of Laravel's `auth` and `auth.session` middleware, skipped on a contract request: Laravel
 * registers `fn () => route('login')` by default, which throws before the `AuthenticationException` exists when the
 * app has no `login` route, so a contract request would get a 500 instead of the api's 401. Every other request keeps
 * the app's callback.
 */
final class GuestRedirects
{
    private const MIDDLEWARE = [Authenticate::class, AuthenticateSession::class];

    /** @var array<string, true> the apis whose contract requests skip the redirect */
    private static array $apis = [];

    /** @var array<class-string, \Closure> the callback installed on each middleware */
    private static array $installed = [];

    private function __construct()
    {
    }

    public static function skipOnContractRequests(string $api): void
    {
        self::$apis[$api] = true;
        foreach (self::MIDDLEWARE as $middleware) {
            self::wrap($middleware);
        }
    }

    /**
     * Another api's runtime copy wraps this copy's callback in turn, so in a long-lived process two apis grow the
     * chain by one closure per request; php-fpm and the built-in server start each request afresh, and Octane is refused.
     *
     * @param class-string<Authenticate|AuthenticateSession> $middleware
     */
    private static function wrap(string $middleware): void
    {
        $appCallback = self::callbackOf($middleware);
        if ($appCallback === null || $appCallback === (self::$installed[$middleware] ?? null)) {
            return;
        }

        $installed = static function (Request $request) use ($appCallback): mixed {
            return self::isContractRequest($request) ? null : call_user_func($appCallback, $request);
        };
        self::$installed[$middleware] = $installed;
        $middleware::redirectUsing($installed);
    }

    /** @param class-string<Authenticate|AuthenticateSession> $middleware */
    private static function callbackOf(string $middleware): ?callable
    {
        // Laravel types the protected callback as callable, yet it stays null until an app or the default builder sets one.
        /** @var callable|null $callback */
        $callback = \Closure::bind(static fn (): mixed => static::$redirectToCallback, null, $middleware)();

        return $callback;
    }

    private static function isContractRequest(Request $request): bool
    {
        foreach (array_keys(self::$apis) as $api) {
            if (BoundaryState::of($request, $api) !== null) {
                return true;
            }
        }

        return false;
    }
}
