<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The compiler binary of a PHP build: pinned by the root package's `extra.seampact.binary` (a dependency's is
 * refused) or the pins `seampact/ir` embeds, copied or downloaded into the private content-addressed cache, and run
 * only from there. A `path` override is copied; a `version` override or the embedded pins download the release asset
 * of this host, and a `url` override the asset of its mirror, each checked against its pin. A development build
 * embeds no pin: without an override it is refused by name (`binary.unpublished`).
 */
final class CompilerBinary
{
    private const FILE_NAME = 'seampact';
    private const WINDOWS_FILE_NAME = 'seampact.exe';

    private const UNPUBLISHED_FIX = 'Set `extra.seampact.binary` in your root composer.json to '
        . '{"path": "<your build of the compiler>", "sha256": "<its SHA-256>"}, or use a bundle source, which needs no binary.';

    private function __construct()
    {
    }

    /**
     * @param array<string, string> $environment the variables of this process
     * @param string $pinsFile the embedded pins unless a test names its own
     * @param ?CacheSafety $safety the host's cache rule unless a test injects one
     * @throws BinaryRefusedException
     */
    public static function install(
        RootPackage $root,
        string $vendorDirectory,
        HostPlatform $host,
        array $environment,
        BinaryDownload $download = new BinaryDownload(),
        string $pinsFile = BinaryPins::EMBEDDED_FILE,
        ?CacheSafety $safety = null,
    ): InstalledBinary {
        RootPackage::refuseDependencyOverrides($vendorDirectory);
        $override = $root->binaryOverride();

        // Only a `path` override carries a single hash; the pins are read before the cache is located.
        if ($override !== null && $override->sha256 !== null) {
            $source = $override->value;
            $sha256 = $override->sha256;
            $installer = static fn (string $cacheRoot, string $fileName, CacheSafety $safety): InstalledBinary
                => BinaryInstaller::install($source, $sha256, $cacheRoot, $fileName, $safety);
        } else {
            [$url, $sha256] = self::releaseAsset($override, $host, $download, $pinsFile);
            $installer = static fn (string $cacheRoot, string $fileName, CacheSafety $safety): InstalledBinary
                => BinaryInstaller::installDownload($url, $sha256, $cacheRoot, $fileName, $safety, $download);
        }

        $cacheRoot = CacheRoot::locate($environment, $host->isWindows());
        $safety ??= $host->isWindows()
            ? new WindowsCacheSafety(UserProfile::locate($environment))
            : new PosixCacheSafety();

        return $installer($cacheRoot, $host->isWindows() ? self::WINDOWS_FILE_NAME : self::FILE_NAME, $safety);
    }

    /**
     * The URL of this host's asset and its pinned hash, from a `version` or `url` override or the embedded pins.
     *
     * @return array{string, string}
     */
    private static function releaseAsset(?BinaryOverride $override, HostPlatform $host, BinaryDownload $download, string $pinsFile): array
    {
        if ($override !== null) {
            $asset = $host->assetName();
            $url = $override->source === BinaryOverrideSource::Url
                ? BinaryDownload::mirrorUrl($override->value, $asset)
                : $download->releaseUrl($override->value, $asset);

            return [$url, $override->sha256ByAsset[$asset]];
        }

        $pins = BinaryPins::embedded($pinsFile);

        if ($pins === null) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::Unpublished,
                'This seampact/ir is a development build: it embeds no binary pin, so it has no binary to run.',
                self::UNPUBLISHED_FIX,
            );
        }

        // With pins, the host decides the asset first, so an unsupported host learns its own fixes.
        $asset = $host->assetName();

        return [$download->releaseUrl($pins->version, $asset), $pins->sha256ByAsset[$asset]];
    }
}
