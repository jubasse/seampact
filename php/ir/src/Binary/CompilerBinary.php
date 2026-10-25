<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The compiler binary of a PHP build: pinned by the root package's `extra.seampact.binary` (a dependency's is
 * refused) or the pins `seampact/ir` embeds, copied into the private content-addressed cache, and run only from
 * there. The compiler is not published yet: a `path` override with its hash is the only way to the binary, and
 * anything else is refused by name (`binary.unpublished`).
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
     * @throws BinaryRefusedException
     */
    public static function install(RootPackage $root, string $vendorDirectory, HostPlatform $host, array $environment): InstalledBinary
    {
        RootPackage::refuseDependencyOverrides($vendorDirectory);
        $override = $root->binaryOverride();

        if ($override === null) {
            self::refuseWithoutOverride($host);
        }

        if ($override->source !== BinaryOverrideSource::Path || $override->sha256 === null) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::Unpublished,
                "The compiler binary is not published yet, so the `{$override->source->value}` override of '{$root->composerFile}' has nothing to download.",
                self::UNPUBLISHED_FIX,
            );
        }

        $cacheRoot = CacheRoot::locate($environment, $host->isWindows());
        $safety = $host->isWindows()
            ? new WindowsCacheSafety($environment['USERPROFILE'] ?? throw self::noUserProfile())
            : new PosixCacheSafety($cacheRoot);

        return BinaryInstaller::install(
            $override->value,
            $override->sha256,
            $cacheRoot,
            $host->isWindows() ? self::WINDOWS_FILE_NAME : self::FILE_NAME,
            $safety,
        );
    }

    /** @return never */
    private static function refuseWithoutOverride(HostPlatform $host): void
    {
        $pins = BinaryPins::embedded();

        // With pins, the host decides the asset first, so an unsupported host learns its own fixes.
        if ($pins !== null) {
            $host->assetName();
        }

        throw BinaryRefusedException::of(
            BinaryFailureCode::Unpublished,
            'The compiler binary is not published yet, so this seampact/ir has no binary to download.',
            self::UNPUBLISHED_FIX,
        );
    }

    private static function noUserProfile(): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::CacheUnavailable,
            'USERPROFILE is not set, so the ACL of the binary cache cannot be checked up to the user profile.',
            'Run seampact as a Windows user with a profile.',
        );
    }
}
