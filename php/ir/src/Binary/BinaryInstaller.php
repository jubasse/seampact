<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * Copies a binary into `<cache root>/<sha256>/`: streamed into a temporary file created exclusively there and
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
        $directory = $cacheRoot . DIRECTORY_SEPARATOR . $sha256;
        $safety->createPrivateDirectory($directory);
        $target = $directory . DIRECTORY_SEPARATOR . $fileName;
        $installed = new InstalledBinary($target, $sha256, $safety);

        if (is_file($target) && hash_file('sha256', $target) === $sha256) {
            $installed->refuseUnlessIntact();

            return $installed;
        }

        $temporary = $directory . DIRECTORY_SEPARATOR . '.' . $fileName . '.' . bin2hex(random_bytes(8)) . '.tmp';
        $actual = self::copyHashing($source, $temporary);

        if ($actual !== $sha256) {
            unlink($temporary);
            throw self::hashMismatch($source, $sha256, $actual);
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

    // The SHA-256 of the bytes streamed from `$source` into the new file `$temporary`.
    private static function copyHashing(string $source, string $temporary): string
    {
        $input = is_file($source) ? @fopen($source, 'rb') : false;
        if ($input === false) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::PinInvalid,
                "The binary override path '{$source}' is not a readable file.",
                'Point `extra.seampact.binary.path` at your build of the compiler.',
            );
        }

        $output = @fopen($temporary, 'xb');
        if ($output === false) {
            fclose($input);
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                "The binary copy '{$temporary}' cannot be created.",
                'Check that your user can write the binary cache directory.',
            );
        }

        $hash = hash_init('sha256');
        while (!feof($input)) {
            $chunk = fread($input, self::CHUNK_BYTES);
            if ($chunk === false || fwrite($output, $chunk) !== strlen($chunk)) {
                fclose($input);
                fclose($output);
                unlink($temporary);
                throw BinaryRefusedException::of(BinaryFailureCode::CacheUnsafe, "Copying '{$source}' into '{$temporary}' failed.", 'Check the free space and permissions of the binary cache.');
            }
            hash_update($hash, $chunk);
        }

        fclose($input);
        fclose($output);

        return hash_final($hash);
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
