<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleDirectoryWalk;
use Seampact\Ir\Bundle\BundleFailure;
use Seampact\Ir\Bundle\BundleFailureCode;
use Seampact\Ir\Bundle\BundleLayout;
use Seampact\Ir\Tests\Support\TemporaryDirectory;

/** The walk of a bundle directory: links and special files are refused, and the file count and byte caps hold. */
#[RequiresOperatingSystemFamily('Linux')]
final class BundleDirectoryWalkTest extends TestCase
{
    private string $directory;

    protected function setUp(): void
    {
        $this->directory = TemporaryDirectory::create('seampact-walk-');
        TemporaryDirectory::write($this->directory, 'ir/t.json', '{}');
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->directory);
    }

    public function testRefusesALinkToAFile(): void
    {
        symlink("{$this->directory}/ir/t.json", "{$this->directory}/ir/linked.json");

        self::assertSame(['ir/linked.json', BundleFailureCode::FileType], self::failureOf(BundleDirectoryWalk::sizes($this->directory)));
    }

    public function testRefusesALinkToADirectory(): void
    {
        symlink("{$this->directory}/ir", "{$this->directory}/sources");

        self::assertSame(['sources', BundleFailureCode::FileType], self::failureOf(BundleDirectoryWalk::sizes($this->directory)));
    }

    public function testRefusesMoreFilesThanTheCap(): void
    {
        mkdir("{$this->directory}/many");
        for ($index = 0; $index < BundleLayout::ENTRIES_MAX; $index++) {
            touch("{$this->directory}/many/{$index}");
        }

        self::assertSame([null, BundleFailureCode::TooManyFiles], self::failureOf(BundleDirectoryWalk::sizes($this->directory)));
    }

    public function testRefusesMoreBytesThanTheCap(): void
    {
        // A sparse file: its size is over the cap, its disk use is none.
        $handle = fopen("{$this->directory}/large.bin", 'x');
        self::assertIsResource($handle);
        self::assertTrue(ftruncate($handle, BundleLayout::EXTRACTED_BYTES_MAX + 1));
        fclose($handle);

        self::assertSame([null, BundleFailureCode::TooLarge], self::failureOf(BundleDirectoryWalk::sizes($this->directory)));
    }

    /**
     * @param array<string, int>|BundleFailure $walk
     * @return array{?string, BundleFailureCode}
     */
    private static function failureOf(array|BundleFailure $walk): array
    {
        self::assertInstanceOf(BundleFailure::class, $walk);

        return [$walk->file, $walk->code];
    }
}
