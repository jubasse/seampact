<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

use PHPUnit\Framework\Assert;

/**
 * Shell scripts that stand in for the compiler binary, so the pin, copy, environment and exit rules are tested
 * without a build of the compiler. POSIX only: `/bin/sh` runs them.
 */
final class StubBinary
{
    /**
     * A stub that writes `$irText` as `<api>.ir.json` into its `--out` directory, after `$body`.
     *
     * @param list<string> $apis
     */
    public static function compiler(string $path, array $apis, string $body = '', string $irText = '{}'): string
    {
        $writes = '';
        foreach ($apis as $api) {
            $writes .= 'printf %s ' . escapeshellarg($irText) . ' > "$out/' . $api . '.ir.json"' . "\n";
        }

        return self::script($path, <<<SH
            out=""
            while [ \$# -gt 0 ]; do
              if [ "\$1" = "--out" ]; then out="\$2"; fi
              shift
            done
            {$body}
            {$writes}exit 0
            SH);
    }

    public static function script(string $path, string $body): string
    {
        Assert::assertNotFalse(file_put_contents($path, "#!/bin/sh\n{$body}\n"));
        Assert::assertTrue(chmod($path, 0700));

        return $path;
    }

    public static function sha256(string $path): string
    {
        $hash = hash_file('sha256', $path);
        Assert::assertIsString($hash);

        return $hash;
    }
}
