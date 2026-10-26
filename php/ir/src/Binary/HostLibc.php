<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The C library of a Linux host; other systems have none to tell apart. */
enum HostLibc: string
{
    case Glibc = 'glibc';
    case Musl = 'musl';
    case Unknown = 'unknown';
    case None = 'none';

    private const MUSL_LOADER_PREFIX = 'ld-musl-';
    private const GLIBC_LOADER_PREFIX = 'ld-linux-';
    private const MUSL_MAPPED_PREFIXES = [self::MUSL_LOADER_PREFIX, 'libc.musl-'];
    private const GLIBC_MAPPED_PREFIXES = ['libc.so.6', self::GLIBC_LOADER_PREFIX];

    /**
     * The libc PHP has mapped, read from the text of `/proc/self/maps` (null when unreadable): musl when a mapped
     * file is musl's loader or libc, glibc when it is `libc.so.6` or glibc's loader. When the maps are unreadable
     * or name neither (a static PHP build), the loaders under `/lib` decide: `ld-musl-*` is musl, `ld-linux-*`
     * glibc, neither unknown.
     *
     * @param list<string> $libraryEntries the file names under `/lib`
     */
    public static function ofLinux(?string $processMaps, array $libraryEntries): self
    {
        $mappedFiles = $processMaps === null ? [] : array_map(
            static fn (string $line): string => basename(trim($line)),
            explode("\n", $processMaps),
        );

        return match (true) {
            self::anyStartsWith($mappedFiles, self::MUSL_MAPPED_PREFIXES) => self::Musl,
            self::anyStartsWith($mappedFiles, self::GLIBC_MAPPED_PREFIXES) => self::Glibc,
            self::anyStartsWith($libraryEntries, [self::MUSL_LOADER_PREFIX]) => self::Musl,
            self::anyStartsWith($libraryEntries, [self::GLIBC_LOADER_PREFIX]) => self::Glibc,
            default => self::Unknown,
        };
    }

    /**
     * @param list<string> $names
     * @param list<string> $prefixes
     */
    private static function anyStartsWith(array $names, array $prefixes): bool
    {
        foreach ($names as $name) {
            foreach ($prefixes as $prefix) {
                if (str_starts_with($name, $prefix)) {
                    return true;
                }
            }
        }

        return false;
    }
}
