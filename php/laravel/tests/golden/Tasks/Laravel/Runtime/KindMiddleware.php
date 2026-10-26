<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

use Illuminate\Container\Container;

/**
 * The app's own route middleware for the routes of one access kind (`public`, `optional`, `identity`, `signed`), read
 * from `config('seampact.<api>.middleware.<kind>')` when the routes are registered, such as `auth:sanctum` on
 * `identity`. A route cache keeps the lists it was built with.
 */
final class KindMiddleware
{
    private function __construct()
    {
    }

    /** @return list<string> */
    public static function of(string $api, string $kind): array
    {
        $key = "seampact.{$api}.middleware.{$kind}";
        $middleware = Services::config(Container::getInstance())->get($key) ?? [];
        if (!is_array($middleware) || !array_is_list($middleware) || array_filter($middleware, is_string(...)) !== $middleware) {
            throw new \LogicException("seampact: config('{$key}') is not a list of middleware names; set it to a list such as ['auth:sanctum'], or to [].");
        }

        return $middleware;
    }
}
