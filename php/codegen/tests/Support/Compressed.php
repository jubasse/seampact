<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** Compressed test bodies, with the compression failure of ext-zlib raised instead of returned as `false`. */
final class Compressed
{
    private function __construct()
    {
    }

    public static function gzip(string $plain): string
    {
        return gzencode($plain) ?: throw new \LogicException('gzencode failed.');
    }

    public static function deflate(string $plain): string
    {
        return gzcompress($plain) ?: throw new \LogicException('gzcompress failed.');
    }
}
