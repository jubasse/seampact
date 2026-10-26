<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Http\Request;

/**
 * The guest redirect of Laravel's `auth` middleware, skipped on a contract request: Laravel registers
 * `fn () => route('login')` by default, which throws before the `AuthenticationException` exists when the app has no
 * `login` route, so a browser `Accept` would get a 500 instead of the api's 401. Every other request keeps the app's
 * callback. Extends `Authenticate` only to read its callback; never instantiated.
 */
abstract class GuestRedirects extends Authenticate
{
    /** @var array<string, true> the apis whose contract requests skip the redirect */
    private static array $apis = [];
    private static ?\Closure $installed = null;

    public static function skipOnContractRequests(string $api): void
    {
        self::$apis[$api] = true;

        // Laravel types the callback as callable, yet it stays null until an app or the default builder sets one.
        /** @var callable|null $current */
        $current = static::$redirectToCallback;
        if ($current === self::$installed) {
            return;
        }

        $appCallback = $current;
        self::$installed = static function (Request $request) use ($appCallback): mixed {
            if (self::isContractRequest($request)) {
                return null;
            }

            return $appCallback === null ? null : call_user_func($appCallback, $request);
        };
        Authenticate::redirectUsing(self::$installed);
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
