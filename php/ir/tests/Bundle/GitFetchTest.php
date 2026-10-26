<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleFailure;
use Seampact\Ir\Bundle\BundleFetcher;
use Seampact\Ir\Bundle\FetchedBundle;
use Seampact\Ir\Bundle\GitFetch;
use Seampact\Ir\Bundle\GitSource;
use Seampact\Ir\Bundle\PrivateDirectory;
use Seampact\Ir\Bundle\ReleaseFetch;
use Seampact\Ir\Config\LocalSourcePolicy;
use Seampact\Ir\Tests\Support\GitRepository;
use Seampact\Ir\Tests\Support\TemporaryDirectory;
use Seampact\Ir\Tests\Support\ValidBundle;

/** The git channel on a local repository with a tag: a shallow fetch read through `git`, never a work tree. */
final class GitFetchTest extends TestCase
{
    private string $directory;

    private string $repository;

    protected function setUp(): void
    {
        $this->directory = TemporaryDirectory::create('seampact-git-test-');
        $this->repository = GitRepository::withValidBundle("{$this->directory}/contract", 'bundle', 'v1');
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->directory);
    }

    public function testFetchesTheBundleDirectoryOfTheTagAndChecksIt(): void
    {
        $fetcher = new BundleFetcher("{$this->directory}/cache", new ReleaseFetch(), new GitFetch(GitRepository::environment()));
        $source = new GitSource('../contract', 'v1', 'bundle', ValidBundle::integrity());

        $fetched = $fetcher->fetch($source, "{$this->directory}/app", LocalSourcePolicy::Allow);

        self::assertInstanceOf(FetchedBundle::class, $fetched);
        self::assertSame(ValidBundle::integrity(), $fetched->integrity);
        self::assertSame(['t'], array_keys($fetched->irDocuments));
        self::assertCount(1, glob("{$this->directory}/cache/bundles/sha256-*") ?: []);
    }

    public function testWritesTheTreeFilesByteForByte(): void
    {
        $fetched = (new GitFetch(GitRepository::environment()))->fetch(new GitSource("file://{$this->repository}", 'v1', 'bundle', null), $this->directory, LocalSourcePolicy::Allow);
        self::assertIsArray($fetched);

        try {
            ValidBundle::writeFiles("{$this->directory}/expected");
            foreach (['seampact-bundle.json', 'ir/t.json'] as $path) {
                self::assertFileEquals("{$this->directory}/expected/{$path}", "{$fetched[0]}/{$path}");
            }
        } finally {
            PrivateDirectory::remove($fetched[1]);
        }
    }

    public function testRefusesALocalRepositoryWhenLocalSourcesAreRefused(): void
    {
        self::assertSame('bundle.source-local', $this->failure(new GitSource('../contract', 'v1', 'bundle', null), LocalSourcePolicy::Refuse)->code->value);
    }

    public function testRefusesUrlsTagsAndDirectoriesByName(): void
    {
        self::assertSame('bundle.git-url', $this->failure(new GitSource('ftp://example.test/contract.git', 'v1', null, null))->code->value);
        self::assertSame('bundle.git-failed', $this->failure(new GitSource('ext::sh -c touch% /tmp/x', 'v1', null, null))->code->value);
        self::assertSame('bundle.git-tag', $this->failure(new GitSource('../contract', '--upload-pack=x', null, null))->code->value);
        self::assertSame('bundle.git-directory', $this->failure(new GitSource('../contract', 'v1', '../bundle', null))->code->value);
        self::assertSame('bundle.git-failed', $this->failure(new GitSource('../contract', 'v404', 'bundle', null))->code->value);
    }

    public function testRefusesALinkInTheTagsTree(): void
    {
        GitRepository::commitLinkAndTag($this->repository, 'bundle/ir/link.json', 'v2');

        self::assertSame('bundle.archive-entry-type', $this->failure(new GitSource('../contract', 'v2', 'bundle', null))->code->value);
    }

    private function failure(GitSource $source, LocalSourcePolicy $policy = LocalSourcePolicy::Allow): BundleFailure
    {
        $fetched = (new GitFetch(GitRepository::environment()))->fetch($source, "{$this->directory}/app", $policy);
        if (is_array($fetched)) {
            PrivateDirectory::remove($fetched[1]);
        }
        self::assertInstanceOf(BundleFailure::class, $fetched);

        return $fetched;
    }
}
