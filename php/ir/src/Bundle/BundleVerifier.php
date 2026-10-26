<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The pinned-bundle check (ADR 0011), on a bundle directory, in order: (0) the manifest; (1) every listed file
 * exists with its size and SHA-256, and no file is unlisted; (2) the integrity recomputed from the list equals the
 * manifest's, then the pin; (3) each api's IR (`BundleIrCheck`). A step runs only when the steps before it pass.
 * Every failure names its file or its two values; a missing or differing pin also gives the actual integrity, so
 * pinning is a copy. The codes and texts are those of the compiler's `bundle/verify.ts`.
 */
final class BundleVerifier
{
    private const NPM_PACKAGE_MANIFEST = 'package.json';

    private const NPM_ALWAYS_INCLUDED = '/^(?:readme|license|licence|changelog)(?:[.-].*)?$/is';

    private function __construct()
    {
    }

    /** Runs the checks on the bundle at `$directory` against the pinned integrity (null: no pin). */
    public static function verify(string $directory, ?string $pinnedIntegrity, BundleChannel $channel): BundleVerification
    {
        $walked = BundleDirectoryWalk::sizes($directory);
        if ($walked instanceof BundleFailure) {
            return BundleVerification::refused([$walked]);
        }

        $manifestSize = $walked[BundleLayout::MANIFEST_FILE] ?? null;
        if ($manifestSize === null) {
            return BundleVerification::refused([new BundleFailure(
                BundleFailureCode::ManifestMissing,
                "The bundle has no '" . BundleLayout::MANIFEST_FILE . "' at its root.",
                'Check that the source names a seampact bundle (`seampact bundle` writes the manifest).',
                BundleLayout::MANIFEST_FILE,
            )]);
        }

        if ($manifestSize > BundleLayout::MANIFEST_BYTES_MAX) {
            return BundleVerification::refused([BundleManifestReader::tooLarge($manifestSize)]);
        }

        $manifest = BundleManifestReader::read(self::readFile($directory, BundleLayout::MANIFEST_FILE));
        if ($manifest instanceof BundleFailure) {
            return BundleVerification::refused([$manifest]);
        }

        $files = [];
        $fileFailures = self::checkFiles($directory, $manifest, $walked, $channel, $files);
        if ($fileFailures !== []) {
            return BundleVerification::refused($fileFailures);
        }

        $integrity = BundleIntegrity::of($manifest->files);
        $integrityFailure = self::checkIntegrity($manifest, $integrity, $pinnedIntegrity);
        if ($integrityFailure !== null) {
            return BundleVerification::refused([$integrityFailure], $integrity);
        }

        return self::checkIrs($manifest, $files, $integrity);
    }

    /** @param array<string, string> $files */
    private static function checkIrs(BundleManifest $manifest, array $files, string $integrity): BundleVerification
    {
        $irs = [];
        $failures = [];

        foreach ($manifest->apis as $api) {
            // The manifest rules list every api's file, and step 1 read every listed file.
            $bytes = $files[$api->file] ?? throw new \LogicException("bundle: the checked file '{$api->file}' of api '{$api->name}' was not read.");
            $checked = BundleIrCheck::check($api, $bytes);

            if ($checked instanceof BundleFailure) {
                $failures[] = $checked;
            } else {
                $irs[$api->name] = $checked;
            }
        }

        return $failures === [] ? BundleVerification::verified($manifest, $integrity, $irs) : BundleVerification::refused($failures, $integrity);
    }

    /**
     * Step 1: every file failure in path order (listed files, then unlisted ones); `$bytesByPath` gets the bytes
     * of every listed file that passed.
     *
     * @param array<string, int> $walked
     * @param array<string, string> $bytesByPath
     * @return list<BundleFailure>
     */
    private static function checkFiles(string $directory, BundleManifest $manifest, array $walked, BundleChannel $channel, array &$bytesByPath): array
    {
        $failures = [];

        foreach ($manifest->files as $file) {
            $failure = self::fileFailure($directory, $file, $walked[$file->path] ?? null, $bytesByPath);
            if ($failure !== null) {
                $failures[] = $failure;
            }
        }

        $listed = array_flip(array_map(static fn (BundleFile $file): string => $file->path, $manifest->files));
        $unlisted = array_values(array_filter(
            array_map('strval', array_keys($walked)),
            static fn (string $path): bool => $path !== BundleLayout::MANIFEST_FILE && !isset($listed[$path]) && !self::isNpmFile($path, $channel),
        ));
        sort($unlisted, SORT_STRING);

        foreach ($unlisted as $path) {
            $failures[] = new BundleFailure(
                BundleFailureCode::FileUnlisted,
                BundleText::quoted($path) . ' is in the bundle and not listed in the manifest.',
                BundleLayout::REFETCH_FIX,
                $path,
            );
        }

        return $failures;
    }

    /** @param array<string, string> $bytesByPath */
    private static function fileFailure(string $directory, BundleFile $file, ?int $size, array &$bytesByPath): ?BundleFailure
    {
        if ($size === null) {
            return new BundleFailure(
                BundleFailureCode::FileMissing,
                "'{$file->path}' is listed in the manifest and missing from the bundle.",
                BundleLayout::REFETCH_FIX,
                $file->path,
            );
        }

        if ($size !== $file->size) {
            return new BundleFailure(
                BundleFailureCode::FileSize,
                "'{$file->path}' holds {$size} bytes; the manifest lists {$file->size}.",
                BundleLayout::REFETCH_FIX,
                $file->path,
                (string) $file->size,
                (string) $size,
            );
        }

        $bytes = self::readFile($directory, $file->path);
        $sha256 = hash('sha256', $bytes);

        if ($sha256 !== $file->sha256) {
            return new BundleFailure(
                BundleFailureCode::FileHash,
                "'{$file->path}' has the SHA-256 {$sha256}; the manifest lists {$file->sha256}.",
                BundleLayout::REFETCH_FIX,
                $file->path,
                $file->sha256,
                $sha256,
            );
        }

        $bytesByPath[$file->path] = $bytes;

        return null;
    }

    private static function isNpmFile(string $path, BundleChannel $channel): bool
    {
        if ($channel !== BundleChannel::Package || str_contains($path, '/')) {
            return false;
        }

        return $path === self::NPM_PACKAGE_MANIFEST || preg_match(self::NPM_ALWAYS_INCLUDED, $path) === 1;
    }

    // Step 2: the manifest's integrity against the recomputed one, then the pin against both.
    private static function checkIntegrity(BundleManifest $manifest, string $integrity, ?string $pinnedIntegrity): ?BundleFailure
    {
        if ($manifest->integrity !== $integrity) {
            return new BundleFailure(
                BundleFailureCode::IntegrityMismatch,
                "The manifest's integrity is {$manifest->integrity}; its file list gives {$integrity}.",
                BundleLayout::REFETCH_FIX,
                BundleLayout::MANIFEST_FILE,
                $manifest->integrity,
                $integrity,
            );
        }

        if ($pinnedIntegrity === null) {
            return new BundleFailure(
                BundleFailureCode::PinMissing,
                "The bundle source pins no integrity; the bundle's is {$integrity}.",
                "Review the bundle, then pin it: integrity: {$integrity}",
                actual: $integrity,
            );
        }

        if ($pinnedIntegrity !== $integrity) {
            return new BundleFailure(
                BundleFailureCode::PinMismatch,
                'The pinned integrity is ' . BundleText::quoted($pinnedIntegrity) . "; the bundle's is {$integrity}.",
                "Fetch the bundle the pin names, or review this one and pin it: integrity: {$integrity}",
                expected: $pinnedIntegrity,
                actual: $integrity,
            );
        }

        return null;
    }

    private static function readFile(string $directory, string $path): string
    {
        $bytes = file_get_contents($directory . '/' . $path);

        if ($bytes === false) {
            throw new \RuntimeException("bundle: reading '{$path}' in '{$directory}' failed; check the directory's permissions.");
        }

        return $bytes;
    }
}
