<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The environment the binary starts with: only the variables of its contract, `TMPDIR`, `TEMP`, `TMP` and, on
 * Windows, `SystemRoot`, so no code the environment names (an OpenSSL configuration, a `NODE_OPTIONS` require)
 * runs inside the pinned binary. Windows names are case-insensitive.
 */
final class ChildEnvironment
{
    private const CONTRACT_VARIABLES = ['TMPDIR', 'TEMP', 'TMP'];

    private const WINDOWS_VARIABLES = ['SYSTEMROOT'];

    private function __construct()
    {
    }

    /**
     * @param array<string, string> $parent
     * @return array<string, string>
     */
    public static function of(array $parent, bool $windows): array
    {
        $allowed = $windows ? [...self::CONTRACT_VARIABLES, ...self::WINDOWS_VARIABLES] : self::CONTRACT_VARIABLES;
        $kept = [];

        foreach ($parent as $name => $value) {
            $comparable = $windows ? strtoupper((string) $name) : (string) $name;
            if (in_array($comparable, $allowed, true)) {
                $kept[(string) $name] = $value;
            }
        }

        return $kept;
    }
}
