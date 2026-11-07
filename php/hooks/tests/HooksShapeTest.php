<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Hooks\Tests\Shape\ManifestMember;
use Seampact\Hooks\Tests\Shape\ManifestType;
use Seampact\Hooks\Tests\Shape\PhpShapeCheck;
use Seampact\Hooks\Tests\Shape\ShapeManifest;

// The package's types against the shape manifest the npm and Java hooks packages share.
final class HooksShapeTest extends TestCase
{
    private const MANIFEST_PATH = '/fixtures/hooks-shape/shape.json';

    /** @return list<ManifestType> */
    private function manifest(): array
    {
        return ShapeManifest::read(dirname(__DIR__, 3) . self::MANIFEST_PATH);
    }

    private function sourceDirectory(): string
    {
        return dirname(__DIR__) . '/src';
    }

    public function testMatchesTheShapeManifest(): void
    {
        self::assertSame([], PhpShapeCheck::check($this->manifest(), $this->sourceDirectory()));
    }

    public function testNamesAMissingMember(): void
    {
        $drifted = array_map(
            static fn (ManifestType $type): ManifestType => $type->name === 'RequestView'
                ? $type->withMember(new ManifestMember('cookies', false, false, null, []))
                : $type,
            $this->manifest(),
        );

        self::assertSame(
            ['RequestView: missing member cookies'],
            PhpShapeCheck::check($drifted, $this->sourceDirectory()),
        );
    }

    public function testNamesAnUnlistedType(): void
    {
        $withoutBucket = array_values(array_filter(
            $this->manifest(),
            static fn (ManifestType $type): bool => $type->name !== 'ThrottleBucket',
        ));

        self::assertSame(
            ['ThrottleBucket: a PHP type that is not in the shape manifest'],
            PhpShapeCheck::check($withoutBucket, $this->sourceDirectory()),
        );
    }
}
