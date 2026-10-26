<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\UnexpectedErrorListener;
use Seampact\Laravel\Runtime\Hooks;

final class HooksTest extends TestCase
{
    public function testNoListenerBindingIsNoListener(): void
    {
        self::assertNull((new Hooks(new Container()))->unexpectedErrorListener());
    }

    public function testAListenerBoundToTheWrongTypeIsRefusedByName(): void
    {
        $container = new Container();
        $container->bind(UnexpectedErrorListener::class, static fn (): \stdClass => new \stdClass());

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('the container binds ' . UnexpectedErrorListener::class . ' to stdClass');
        (new Hooks($container))->unexpectedErrorListener();
    }
}
