<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleCache;
use Seampact\Ir\Bundle\BundleFetcher;
use Seampact\Ir\Bundle\FetchedBundle;
use Seampact\Ir\Bundle\GitFetch;
use Seampact\Ir\Bundle\ReleaseFetch;
use Seampact\Ir\Bundle\ReleaseSource;
use Seampact\Ir\Config\LocalSourcePolicy;
use Seampact\Ir\Tests\Support\SecondReadTampering;
use Seampact\Ir\Tests\Support\TemporaryDirectory;
use Seampact\Ir\Tests\Support\ValidBundle;

/** A cached bundle hands the targets the IR bytes the pinned-bundle check read, never a second read of the file. */
final class CachedBundleReadTest extends TestCase
{
    private const IR_FILE = '/ir/t.json';

    private string $directory;

    protected function setUp(): void
    {
        $this->directory = TemporaryDirectory::create('seampact-cache-read-');
    }

    protected function tearDown(): void
    {
        SecondReadTampering::uninstall();
        TemporaryDirectory::remove($this->directory);
    }

    public function testHandsTheCheckedIrEvenWhenTheFileChangesAfterTheCheck(): void
    {
        $cacheDirectory = "{$this->directory}/cache";
        $entry = (new BundleCache($cacheDirectory))->entryOf(ValidBundle::integrity());
        self::assertIsString($entry);
        ValidBundle::writeFiles($entry);
        $checkedIr = json_decode((string) file_get_contents($entry . self::IR_FILE), false);

        $fetcher = new BundleFetcher($cacheDirectory, new ReleaseFetch(), new GitFetch([]));
        $source = new ReleaseSource('https://example.test/bundle.tgz', ValidBundle::integrity());
        // A first read loads every class the fetch needs before the wrapper is in place.
        self::assertInstanceOf(FetchedBundle::class, $fetcher->fetch($source, $this->directory, LocalSourcePolicy::Refuse));

        SecondReadTampering::install(self::IR_FILE, '{"irVersion": 0, "swapped": true}');
        $fetched = $fetcher->fetch($source, $this->directory, LocalSourcePolicy::Refuse);
        SecondReadTampering::uninstall();

        self::assertInstanceOf(FetchedBundle::class, $fetched);
        self::assertEquals($checkedIr, $fetched->irDocuments['t']);
        self::assertSame(1, SecondReadTampering::watchedOpens());
    }
}
