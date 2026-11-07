<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The binary contract's release assets: one binary per platform and the manifest of their SHA-256 hashes, the
 * names of `packages/tools/binary/scripts/binary-names.mjs`.
 */
final class ReleaseAssets
{
    public const LINUX_X64 = 'seampact-linux-x64';
    public const LINUX_ARM64 = 'seampact-linux-arm64';
    public const DARWIN_X64 = 'seampact-darwin-x64';
    public const DARWIN_ARM64 = 'seampact-darwin-arm64';
    public const WIN32_X64 = 'seampact-win32-x64.exe';

    public const BINARIES = [self::LINUX_X64, self::LINUX_ARM64, self::DARWIN_X64, self::DARWIN_ARM64, self::WIN32_X64];

    public const MANIFEST = 'SHA256SUMS';

    private const SHA256_PATTERN = '/^[0-9a-f]{64}$/D';

    private function __construct()
    {
    }

    /** @phpstan-assert-if-true string $value */
    public static function isSha256(mixed $value): bool
    {
        return is_string($value) && preg_match(self::SHA256_PATTERN, $value) === 1;
    }
}
