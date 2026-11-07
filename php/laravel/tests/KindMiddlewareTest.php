<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Laravel\Runtime\KindMiddleware;

/** The per-kind middleware lists an app sets in `config('seampact.<api>.middleware')`. */
final class KindMiddlewareTest extends TestCase
{
    protected function tearDown(): void
    {
        Container::setInstance(null);
    }

    public function testAListIsReadAndAMissingKindIsEmpty(): void
    {
        self::withConfig(['auth:sanctum']);

        self::assertSame(['auth:sanctum'], KindMiddleware::of('tasks', 'identity'));
        self::assertSame([], KindMiddleware::of('tasks', 'public'));
    }

    public function testAValueThatIsNotAListOfNamesIsRefusedWithItsKey(): void
    {
        self::withConfig('auth:sanctum');

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("config('seampact.tasks.middleware.identity') is not a list of middleware names");

        KindMiddleware::of('tasks', 'identity');
    }

    private static function withConfig(mixed $identityMiddleware): void
    {
        $container = new Container();
        $container->instance('config', new Repository(['seampact' => ['tasks' => ['middleware' => ['identity' => $identityMiddleware]]]]));
        Container::setInstance($container);
    }
}
