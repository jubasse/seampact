<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Laravel\Runtime\BootCheck;

/**
 * The framework-route allow-list of the boot check, the rule Spring's `BootCheck.isAllowListed` shares: `*` takes
 * one segment, `**` any number, and a method takes only a route answering that one method besides HEAD.
 */
final class BootCheckTest extends TestCase
{
    public function testOneStarTakesExactlyOneSegment(): void
    {
        $allowed = [['path' => '/admin/*', 'method' => null]];

        self::assertTrue(BootCheck::allowsRoute($allowed, '/admin/users', ['GET', 'HEAD']));
        self::assertFalse(BootCheck::allowsRoute($allowed, '/admin', ['GET', 'HEAD']));
        self::assertFalse(BootCheck::allowsRoute($allowed, '/admin/users/1', ['GET', 'HEAD']));
    }

    public function testTwoStarsTakeAnyNumberOfSegments(): void
    {
        $allowed = [['path' => '/__seampact/**', 'method' => null]];

        self::assertTrue(BootCheck::allowsRoute($allowed, '/__seampact', ['PUT']));
        self::assertTrue(BootCheck::allowsRoute($allowed, '/__seampact/script', ['PUT']));
        self::assertTrue(BootCheck::allowsRoute($allowed, '/__seampact/a/b', ['GET', 'HEAD']));
        self::assertFalse(BootCheck::allowsRoute($allowed, '/__seampactx/script', ['PUT']));
    }

    public function testAMethodTakesOnlyARouteAnsweringThatOneMethod(): void
    {
        $allowed = [['path' => '/v1/unlisted', 'method' => 'GET']];

        self::assertTrue(BootCheck::allowsRoute($allowed, '/v1/unlisted', ['GET', 'HEAD']));
        self::assertFalse(BootCheck::allowsRoute($allowed, '/v1/unlisted', ['POST']));
        self::assertFalse(BootCheck::allowsRoute($allowed, '/v1/unlisted', ['GET', 'POST']));
    }

    public function testALiteralSegmentIsNotAPattern(): void
    {
        self::assertFalse(BootCheck::allowsRoute([['path' => '/up.json', 'method' => null]], '/upxjson', ['GET']));
    }
}
