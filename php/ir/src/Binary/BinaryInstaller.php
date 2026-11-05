<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

use Seampact\Ir\Https\PrintableUrl;


/**
 * Hashes a `path` source first, so a warm cache never hides a source that changed; a download runs only when the cache
 * holds no intact entry of its pin. Creates the cache root and resolves its real path once; only that path is checked
 * and run from then on. Checks the cache before any copy, then copies
 * a binary into `<cache root>/<sha256>/`: streamed into a temporary file created exclusively there and
 * hashed as it streams, made executable, then renamed atomically to its name. An entry already there with the
 * right hash counts as success, so concurrent runs and a running `.exe` on Windows are safe. A copy whose hash
 * differs is deleted and refused. Only the copy ever runs, never the file it came from.
 */
final class BinaryInstaller
{
    private const CHUNK_BYTES = 64 * 1024;

    private const EXECUTABLE_BY_OWNER = 0700;

    private function __construct()
    {
    }

    /** @throws BinaryRefusedException */
    public static function install(string $source, string $sha256, string $cacheRoot, string $fileName, CacheSafety $safety): InstalledBinary
    {
        $sourceSha256 = self::sourceSha256($source);
        if ($sourceSha256 !== $sha256) {
            throw self::hashMismatch($source, $sha256, $sourceSha256);
        }

        return self::installInto(
            $source,
            $sha256,
            $cacheRoot,
            $fileName,
            $safety,
            static fn (string $temporary): string => self::copyHashing($source, $temporary),
        );
    }

    /**
     * Downloads `$url` into the cache unless an intact entry of `$sha256` is already there.
     *
     * @throws BinaryRefusedException
     */
    public static function installDownload(string $url, string $sha256, string $cacheRoot, string $fileName, CacheSafety $safety, BinaryDownload $download): InstalledBinary
    {
        BinaryDownload::refuseUnlessHttps($url);

        return self::installInto(
            PrintableUrl::of($url),
            $sha256,
            $cacheRoot,
            $fileName,
            $safety,
            static fn (string $temporary): string => self::downloadHashing($url, $temporary, $download),
        );
    }

    /**
     * @param string $origin the source path or the printable URL, for messages
     * @param \Closure(string): string $writeHashing writes the binary into the new temporary file and returns its hash
     * @throws BinaryRefusedException
     */
    private static function installInto(
        string $origin,
        string $sha256,
        string $cacheRoot,
        string $fileName,
        CacheSafety $safety,
        \Closure $writeHashing,
    ): InstalledBinary {
        $safety->createPrivateDirectory($cacheRoot);
        $realCacheRoot = self::realCacheRoot($cacheRoot);
        $directory = $realCacheRoot . DIRECTORY_SEPARATOR . $sha256;
        $safety->createPrivateDirectory($directory);
        $safety->refuseUnsafe($directory, $realCacheRoot);
        $target = $directory . DIRECTORY_SEPARATOR . $fileName;
        $installed = new InstalledBinary($target, $sha256, $realCacheRoot, $safety);

        if (is_file($target) && hash_file('sha256', $target) === $sha256) {
            $installed->refuseUnlessIntact();

            return $installed;
        }

        $temporary = $directory . DIRECTORY_SEPARATOR . '.' . $fileName . '.' . bin2hex(random_bytes(8)) . '.tmp';
        $actual = $writeHashing($temporary);

        if ($actual !== $sha256) {
            unlink($temporary);
            throw self::hashMismatch($origin, $sha256, $actual);
        }

        if (!chmod($temporary, self::EXECUTABLE_BY_OWNER) || !self::renamed($temporary, $target, $sha256)) {
            @unlink($temporary);
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                "The binary copy '{$temporary}' cannot be made executable or renamed to '{$target}'.",
                "Check that your user can write '{$directory}'.",
            );
        }

        $installed->refuseUnlessIntact();

        return $installed;
    }

    public static function hashMismatch(string $file, string $expected, string $actual): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::HashMismatch,
            "The compiler binary '{$file}' has the SHA-256 {$actual}; the pin is {$expected}. It is never run.",
            'Point the override at the build the pin names, or pin the SHA-256 of your own build after you review it.',
        );
    }

    private static function realCacheRoot(string $cacheRoot): string
    {
        $real = realpath($cacheRoot);

        if ($real === false) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                "The binary cache root '{$cacheRoot}' cannot be resolved to its real path.",
                'Check that your user can read the cache directory and each of its parents.',
            );
        }

        return $real;
    }

    // The source is hashed before any cache lookup, so a warm cache never hides a source that changed.
    private static function sourceSha256(string $source): string
    {
        $sha256 = is_file($source) ? @hash_file('sha256', $source) : false;
        if ($sha256 === false) {
            throw self::unreadableSource($source);
        }

        return $sha256;
    }

    private static function unreadableSource(string $source): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::PinInvalid,
            "The binary override path '{$source}' is not a readable file.",
            'Point `extra.seampact.binary.path` at your build of the compiler.',
        );
    }

    // The SHA-256 of the bytes streamed from `$source` into the new file `$temporary`.
    private static function copyHashing(string $source, string $temporary): string
    {
        $input = is_file($source) ? @fopen($source, 'rb') : false;
        if ($input === false) {
            throw self::unreadableSource($source);
        }

        try {
            $output = self::createTemporary($temporary);
        } catch (BinaryRefusedException $refused) {
            fclose($input);
            throw $refused;
        }

        $hash = hash_init('sha256');
        while (!feof($input)) {
            $chunk = fread($input, self::CHUNK_BYTES);
            if ($chunk === false || fwrite($output, $chunk) !== strlen($chunk)) {
                fclose($input);
                fclose($output);
                unlink($temporary);
                throw self::writeFailed("'{$source}'", $temporary);
            }
            hash_update($hash, $chunk);
        }

        fclose($input);
        fclose($output);

        return hash_final($hash);
    }

    // The SHA-256 of the bytes downloaded from `$url` into the new file `$temporary`, which any failure removes.
    private static function downloadHashing(string $url, string $temporary, BinaryDownload $download): string
    {
        $output = self::createTemporary($temporary);
        $hash = hash_init('sha256');

        try {
            $download->stream($url, static function (string $chunk) use ($output, $hash, $temporary): void {
                if (fwrite($output, $chunk) !== strlen($chunk)) {
                    throw self::writeFailed('the download', $temporary);
                }

                hash_update($hash, $chunk);
            });
        } catch (\Throwable $failure) {
            fclose($output);
            @unlink($temporary);
            throw $failure;
        }

        fclose($output);

        return hash_final($hash);
    }

    /** @return resource */
    private static function createTemporary(string $temporary)
    {
        $output = @fopen($temporary, 'xb');
        if ($output === false) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                "The binary copy '{$temporary}' cannot be created.",
                'Check that your user can write the binary cache directory.',
            );
        }

        return $output;
    }

    private static function writeFailed(string $what, string $temporary): BinaryRefusedException
    {
        return BinaryRefusedException::of(BinaryFailureCode::CacheUnsafe, "Copying {$what} into '{$temporary}' failed.", 'Check the free space and permissions of the binary cache.');
    }

    // A failed rename over an entry another run installed with the right hash counts as success.
    private static function renamed(string $temporary, string $target, string $sha256): bool
    {
        if (@rename($temporary, $target)) {
            return true;
        }

        if (is_file($target) && hash_file('sha256', $target) === $sha256) {
            unlink($temporary);

            return true;
        }

        return false;
    }
}
