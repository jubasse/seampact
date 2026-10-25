<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * Refuses a PHP release without the October 2026 fixes (PHP2Shell, CVE-2026-109618 and CVE-2026-109619), since
 * Composer's runtime platform check tests only the lowest bound of `>=8.3.36 <8.4 || >=8.4.27 <8.5 || >=8.5.12`.
 * A distribution build that backports the fixes passes with `extra.seampact.phpPatched: true`. It runs when
 * seampact generates or checks code, never while the app serves requests.
 */
final class PhpRuntimeCheck
{
    // The first fixed release of each supported branch; a later branch ships with the fixes.
    private const FIXED_RELEASES = ['8.3' => '8.3.36', '8.4' => '8.4.27', '8.5' => '8.5.12'];

    private const FLOOR = '8.3.36';

    private function __construct()
    {
    }

    /** @throws BinaryRefusedException `php.unpatched`, naming the running version and the fixed release */
    public static function check(string $runningVersion, bool $phpPatched): void
    {
        if ($phpPatched) {
            return;
        }

        $release = preg_match('/^(\d+)\.(\d+)\.(\d+)/', $runningVersion, $parts) === 1
            ? "{$parts[1]}.{$parts[2]}.{$parts[3]}"
            : $runningVersion;
        $branch = isset($parts[1], $parts[2]) ? "{$parts[1]}.{$parts[2]}" : '';
        $fixed = self::FIXED_RELEASES[$branch] ?? null;

        if ($fixed === null && version_compare($release, self::FLOOR, '>=')) {
            return;
        }

        $fixed ??= self::FLOOR;
        if (version_compare($release, $fixed, '>=')) {
            return;
        }

        throw BinaryRefusedException::of(
            BinaryFailureCode::PhpUnpatched,
            "PHP {$runningVersion} lacks the fixes of CVE-2026-109618 and CVE-2026-109619; the first fixed release of its branch is {$fixed}.",
            "Upgrade PHP to {$fixed} or later. If your distribution backports the fixes under an older version number, "
                . 'set `"phpPatched": true` under `extra.seampact` in your root composer.json.',
        );
    }
}
