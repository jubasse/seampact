<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The bundle integrity (`schemas/bundle/README.md`, "Integrity"): one line per listed file,
 * `<sha256 lowercase hex>  <path>\n`, sorted by path in code-unit order, the manifest excluded, encoded as UTF-8;
 * the integrity is `sha256-` and the padded standard base64 of its SHA-256, the SRI form npm uses.
 */
final class BundleIntegrity
{
    private const PREFIX = 'sha256-';

    private function __construct()
    {
    }

    /** @param list<BundleFile> $files in any order */
    public static function of(array $files): string
    {
        usort($files, static fn (BundleFile $left, BundleFile $right): int => strcmp($left->path, $right->path));
        $canonicalList = implode('', array_map(static fn (BundleFile $file): string => "{$file->sha256}  {$file->path}\n", $files));

        return self::PREFIX . base64_encode(hash('sha256', $canonicalList, true));
    }
}
