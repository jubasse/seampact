<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The Windows user profile directory (`%USERPROFILE%`), resolved to its real path as the cache root is, so a
 * profile reached through a junction or a short (8.3) name is not misread as outside the profile.
 */
final class UserProfile
{
    private function __construct()
    {
    }

    /**
     * @param array<string, string> $environment
     * @throws BinaryRefusedException `binary.cache-unavailable` when USERPROFILE is unset or cannot be resolved
     */
    public static function locate(array $environment): string
    {
        $profile = $environment['USERPROFILE'] ?? '';
        if ($profile === '') {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnavailable,
                'USERPROFILE is not set, so the ACL of the binary cache cannot be checked up to the user profile.',
                'Run seampact as a Windows user with a profile.',
            );
        }

        $real = realpath($profile);
        if ($real === false) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnavailable,
                "USERPROFILE is '{$profile}', which cannot be resolved to its real path, so the ACL of the binary cache cannot be checked up to it.",
                'Run seampact as a Windows user whose profile directory exists and is readable.',
            );
        }

        return $real;
    }
}
