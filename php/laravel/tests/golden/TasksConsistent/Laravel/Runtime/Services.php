<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Contracts\Container\Container;
use Illuminate\Contracts\Events\Dispatcher;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;

/** The framework services the runtime reads, resolved from the container and checked for their type. */
final class Services
{
    private function __construct()
    {
    }

    public static function config(Container $container): Repository
    {
        $config = $container->make('config');

        return $config instanceof Repository ? $config : throw new \LogicException('seampact: the container holds no config repository.');
    }

    public static function events(Container $container): Dispatcher
    {
        $events = $container->make('events');

        return $events instanceof Dispatcher ? $events : throw new \LogicException('seampact: the container holds no event dispatcher.');
    }

    /** The route Laravel chose for `$request`, null before routing ran or when it found none. */
    public static function route(Request $request): ?Route
    {
        $route = ($request->getRouteResolver())();

        return $route instanceof Route ? $route : null;
    }
}
