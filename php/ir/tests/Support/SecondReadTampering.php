<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

/**
 * A `file://` stream wrapper that hands other bytes on the second open of one file, as a writer swapping the file
 * between two reads would: a reader that checks a file and then reads it again sees the swap. Every other call goes
 * to PHP's own file wrapper.
 */
final class SecondReadTampering
{
    private const PROTOCOL = 'file';

    private static string $watchedSuffix = '';

    private static string $swappedBytes = '';

    private static int $watchedOpens = 0;

    private static bool $installed = false;

    /** @var resource|null set by PHP for a wrapper instance */
    public $context;

    /** @var resource|null */
    private $handle;

    /** @var list<string> */
    private array $entries = [];

    /** Swaps the bytes of the file whose path ends with `$suffix` from its second open on, until `uninstall`. */
    public static function install(string $suffix, string $swappedBytes): void
    {
        self::$watchedSuffix = $suffix;
        self::$swappedBytes = $swappedBytes;
        self::$watchedOpens = 0;
        self::$installed = true;
        self::register();
    }

    public static function uninstall(): void
    {
        if (self::$installed) {
            self::$installed = false;
            stream_wrapper_restore(self::PROTOCOL);
        }
    }

    public static function watchedOpens(): int
    {
        return self::$watchedOpens;
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        if (str_ends_with($path, self::$watchedSuffix) && self::$watchedOpens++ > 0) {
            $memory = fopen('php://memory', 'w+');
            if ($memory === false) {
                return false;
            }
            fwrite($memory, self::$swappedBytes);
            rewind($memory);
            $this->handle = $memory;

            return true;
        }

        $handle = self::native(static fn () => @fopen($path, $mode));
        $this->handle = is_resource($handle) ? $handle : null;

        return $this->handle !== null;
    }

    public function stream_read(int $count): string|false
    {
        return $this->handle === null ? false : fread($this->handle, max(1, $count));
    }

    public function stream_write(string $data): int|false
    {
        return $this->handle === null ? false : fwrite($this->handle, $data);
    }

    public function stream_eof(): bool
    {
        return $this->handle === null || feof($this->handle);
    }

    /** @return array<int|string, int>|false */
    public function stream_stat(): array|false
    {
        return $this->handle === null ? false : fstat($this->handle);
    }

    public function stream_set_option(int $option, int $first, ?int $second): bool
    {
        return false;
    }

    public function stream_close(): void
    {
        if ($this->handle !== null) {
            fclose($this->handle);
        }
    }

    /** @return array<int|string, int>|false */
    public function url_stat(string $path, int $flags): array|false
    {
        $linkStat = ($flags & STREAM_URL_STAT_LINK) !== 0;

        return self::native(static fn () => $linkStat ? @lstat($path) : @stat($path));
    }

    public function dir_opendir(string $path, int $options): bool
    {
        $names = self::native(static fn () => @scandir($path));
        $this->entries = is_array($names) ? array_reverse($names) : [];

        return is_array($names);
    }

    public function dir_readdir(): string|false
    {
        return array_pop($this->entries) ?? false;
    }

    public function dir_closedir(): bool
    {
        return true;
    }

    private static function register(): void
    {
        stream_wrapper_unregister(self::PROTOCOL);
        stream_wrapper_register(self::PROTOCOL, self::class);
    }

    /**
     * @template T
     * @param callable(): T $call
     * @return T
     */
    private static function native(callable $call): mixed
    {
        stream_wrapper_restore(self::PROTOCOL);

        try {
            return $call();
        } finally {
            self::register();
        }
    }
}
