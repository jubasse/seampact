<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\FrameworkRoutes;

/**
 * The framework-route allow-list of the boot check, the rule Spring's `BootCheck.isAllowListed` shares: `*` takes
 * one segment, `**` any number, a `*` inside a segment any characters but `/`, and a method takes only a route answering that one method besides HEAD.
 */
final class FrameworkRoutesTest extends TestCase
{
    public function testOneStarTakesExactlyOneSegment(): void
    {
        $allowed = [['path' => '/admin/*', 'method' => null]];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/admin/users', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/admin', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/admin/users/1', ['GET', 'HEAD']));
    }

    public function testTwoStarsTakeAnyNumberOfSegments(): void
    {
        $allowed = [['path' => '/__seampact/**', 'method' => null]];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/__seampact', ['PUT']));
        self::assertTrue(FrameworkRoutes::allows($allowed, '/__seampact/script', ['PUT']));
        self::assertTrue(FrameworkRoutes::allows($allowed, '/__seampact/a/b', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/__seampactx/script', ['PUT']));
    }

    public function testAStarInsideASegmentTakesAnyCharactersButASlash(): void
    {
        $allowed = [['path' => '/livewire-*/**', 'method' => null]];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/livewire-3f9a/upload-file', ['POST']));
        self::assertTrue(FrameworkRoutes::allows($allowed, '/livewire-/update', ['POST']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/live-3f9a/upload-file', ['POST']));
        self::assertTrue(FrameworkRoutes::allows([['path' => '/livewire*/**', 'method' => null]], '/livewire/update', ['POST']));
        self::assertFalse(FrameworkRoutes::allows([['path' => '/livewire-*', 'method' => null]], '/livewire-3f9a/upload-file', ['POST']));
        self::assertTrue(FrameworkRoutes::allows([['path' => '/*.json', 'method' => null]], '/up.json', ['GET']));
        self::assertFalse(FrameworkRoutes::allows([['path' => '/*.json', 'method' => null]], '/up.xml', ['GET']));
    }

    public function testAMethodTakesOnlyARouteAnsweringThatOneMethod(): void
    {
        $allowed = [['path' => '/v1/unlisted', 'method' => 'GET']];

        self::assertTrue(FrameworkRoutes::allows($allowed, '/v1/unlisted', ['GET', 'HEAD']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/v1/unlisted', ['POST']));
        self::assertFalse(FrameworkRoutes::allows($allowed, '/v1/unlisted', ['GET', 'POST']));
    }

    public function testALiteralSegmentIsNotAPattern(): void
    {
        self::assertFalse(FrameworkRoutes::allows([['path' => '/up.json', 'method' => null]], '/upxjson', ['GET']));
    }
}
