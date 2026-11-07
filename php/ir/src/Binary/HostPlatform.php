<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The host as PHP reports it: `PHP_OS_FAMILY`, `php_uname('m')` and, on Linux, the C library PHP has mapped. The
 * table of ADR 0010 maps it to a release asset; any other row, musl and BSD included, is refused by name.
 */
final readonly class HostPlatform
{
    private const PROCESS_MAPS = '/proc/self/maps';
    private const LIBRARY_DIRECTORY = '/lib';

    private const ASSETS = [
        'Linux glibc x86_64' => ReleaseAssets::LINUX_X64,
        'Linux glibc aarch64' => ReleaseAssets::LINUX_ARM64,
        'Darwin none x86_64' => ReleaseAssets::DARWIN_X64,
        'Darwin none arm64' => ReleaseAssets::DARWIN_ARM64,
        'Windows none AMD64' => ReleaseAssets::WIN32_X64,
    ];

    public function __construct(public string $osFamily, public string $machine, public HostLibc $libc)
    {
    }

    public static function current(): self
    {
        $libc = PHP_OS_FAMILY === 'Linux' ? HostLibc::ofLinux(self::processMaps(), self::libraryEntries()) : HostLibc::None;

        return new self(PHP_OS_FAMILY, php_uname('m'), $libc);
    }

    public function isWindows(): bool
    {
        return $this->osFamily === 'Windows';
    }

    /** @throws BinaryRefusedException `binary.platform-unsupported`, naming the OS, arch and C library */
    public function assetName(): string
    {
        $asset = self::ASSETS["{$this->osFamily} {$this->libc->value} {$this->machine}"] ?? null;

        if ($asset === null) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::PlatformUnsupported,
                "The standalone compiler binary has no build for this host: PHP_OS_FAMILY '{$this->osFamily}', "
                    . "php_uname('m') '{$this->machine}', C library {$this->libc->value}. It is built for Linux x86_64 "
                    . 'and aarch64 (glibc), Darwin x86_64 and arm64, and Windows AMD64.',
                'Use a bundle source, which needs no binary; or build on a glibc image of a supported platform; or '
                    . 'point `extra.seampact.binary.path` at your own build of the compiler, with its `sha256`.',
            );
        }

        return $asset;
    }

    private static function processMaps(): ?string
    {
        if (!is_readable(self::PROCESS_MAPS)) {
            return null;
        }

        $text = file_get_contents(self::PROCESS_MAPS);

        return $text === false ? null : $text;
    }

    /** @return list<string> */
    private static function libraryEntries(): array
    {
        $entries = is_dir(self::LIBRARY_DIRECTORY) ? scandir(self::LIBRARY_DIRECTORY) : false;

        return $entries === false ? [] : $entries;
    }
}
