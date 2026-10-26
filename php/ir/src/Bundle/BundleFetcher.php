<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Config\LocalSourcePolicy;

/**
 * A bundle source fetched from its channel and put through the pinned-bundle check, so its IR is read with no
 * compiler run (ADR 0011, as the Node runner's `fetch.ts`): a release asset over HTTPS or a git tag with the system
 * `git`. A fetched bundle is cached by its pinned integrity once it passed, and the check runs again on every cache
 * read. A `package` or `maven` source needs another ecosystem's registry and is refused by name, naming the forms of
 * the same bundle a PHP build reads.
 */
final readonly class BundleFetcher
{
    // The codes of the pinned-bundle check's step 3 (`bundle.ir-version`, `bundle.ir-revision`...).
    private const IR_CHECK_CODE_PREFIX = 'bundle.ir-';

    private const OTHER_FORMS = 'Use the same bundle as a release asset (`release: { url }`) or a git tag (`git: { url, tag, directory }`), with the same integrity.';

    private BundleCache $cache;

    public function __construct(string $cacheDirectory, private ReleaseFetch $release, private GitFetch $git)
    {
        $this->cache = new BundleCache($cacheDirectory);
    }

    /**
     * Fetches and checks `$source`; `$baseDirectory` is where a local git path is relative to, and `$localSources`
     * whether a local git repository may be fetched.
     *
     * @return FetchedBundle|list<BundleFailure>
     */
    public function fetch(BundleSource $source, string $baseDirectory, LocalSourcePolicy $localSources): FetchedBundle|array
    {
        $problem = match (true) {
            $source instanceof RegistrySource => self::registryUnsupported($source),
            $source instanceof ReleaseSource => ReleaseFetch::sourceProblem($source),
            $source instanceof GitSource => GitFetch::sourceProblem($source, $localSources),
            default => throw new \LogicException('bundle: an unknown source kind ' . $source::class . '.'),
        };
        if ($problem !== null) {
            return [$problem];
        }

        $channel = $source instanceof GitSource ? BundleChannel::Git : BundleChannel::Release;
        $integrity = $source->integrity();
        $entry = $integrity === null ? null : $this->cache->entryOf($integrity);
        if ($entry !== null && is_dir($entry)) {
            return self::readCacheEntry($entry, $integrity, $channel);
        }

        $fetched = $this->fetchedDirectory($source, $baseDirectory, $localSources);
        if ($fetched instanceof BundleFailure) {
            return [$fetched];
        }

        [$directory, $temporary] = $fetched;

        try {
            $verified = self::verified($directory, $integrity, $channel);
            if ($verified instanceof FetchedBundle && $entry !== null) {
                $this->cache->store($directory, $entry);
            }

            return $verified;
        } finally {
            PrivateDirectory::remove($temporary);
        }
    }

    /** @return array{string, string}|BundleFailure the bundle directory and the temporary directory to remove */
    private function fetchedDirectory(BundleSource $source, string $baseDirectory, LocalSourcePolicy $localSources): array|BundleFailure
    {
        if ($source instanceof GitSource) {
            return $this->git->fetch($source, $baseDirectory, $localSources);
        }

        if (!$source instanceof ReleaseSource) {
            throw new \LogicException('bundle: only release and git sources are fetched.');
        }

        $tarball = $this->release->download($source);
        if ($tarball instanceof BundleFailure) {
            return $tarball;
        }

        // The archive reader refuses a tarball on its first problem.
        $extracted = BundleTarball::extract($tarball);

        return is_string($extracted) ? [$extracted, $extracted] : $extracted[0];
    }

    /** @return FetchedBundle|list<BundleFailure> */
    private static function verified(string $directory, ?string $integrity, BundleChannel $channel): FetchedBundle|array
    {
        $verification = BundleVerifier::verify($directory, $integrity, $channel);
        if (!$verification->ok || $verification->manifest === null || $verification->integrity === null) {
            return $verification->failures;
        }

        // The bytes the check read, never the file again: a cache writer could swap it between the check and a read.
        $documents = [];
        foreach ($verification->irBytes as $apiName => $bytes) {
            $parsed = UntrustedJson::parse($bytes);
            $documents[$apiName] = $parsed->document instanceof \stdClass
                ? $parsed->document
                : throw new \LogicException("bundle: the checked IR of api '{$apiName}' does not parse again.");
        }
        ksort($documents, SORT_STRING);

        return new FetchedBundle($verification->integrity, $documents);
    }

    // A cache entry is checked again on every read; one whose files fail (steps 1-2) names itself, since only removing
    // it heals it. An IR check failure (step 3) is on bytes that match the pin, so refetching gives the same failure.
    /** @return FetchedBundle|list<BundleFailure> */
    private static function readCacheEntry(string $entry, ?string $integrity, BundleChannel $channel): FetchedBundle|array
    {
        $verified = self::verified($entry, $integrity, $channel);
        if ($verified instanceof FetchedBundle) {
            return $verified;
        }

        $onlyIrFailures = array_filter($verified, static fn (BundleFailure $failure): bool => !str_starts_with($failure->code->value, self::IR_CHECK_CODE_PREFIX)) === [];
        if ($onlyIrFailures) {
            return $verified;
        }

        return [new BundleFailure(
            BundleFailureCode::CacheInvalid,
            "The cached bundle at {$entry} fails the pinned-bundle check; it was changed after it was cached.",
            "Remove {$entry}, then run again to fetch the bundle afresh.",
            $entry,
        ), ...$verified];
    }

    private static function registryUnsupported(RegistrySource $source): BundleFailure
    {
        if ($source->registry === RegistrySource::MAVEN) {
            return new BundleFailure(
                BundleFailureCode::MavenJvmOnly,
                "The bundle source {$source->describe()} is a Maven artefact; only the JVM build plugins resolve Maven artefacts.",
                self::OTHER_FORMS,
            );
        }

        return new BundleFailure(
            BundleFailureCode::PackageUnsupported,
            "The bundle source {$source->describe()} is an npm package; a PHP build does not read the npm registry yet, it comes once a PHP app needs it.",
            self::OTHER_FORMS,
        );
    }
}
