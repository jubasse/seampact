<?php

declare(strict_types=1);

namespace App\Suite;

/** The suite's shared credentials (`credentials.json`, the file the suite sends them from). */
final class Credentials
{
    private function __construct()
    {
    }

    public static function text(string $name): string
    {
        $value = self::all()[$name] ?? null;
        if (!is_string($value)) {
            throw new \UnexpectedValueException("credentials.json holds no text '{$name}'");
        }

        return $value;
    }

    public static function number(string $name): int
    {
        $value = self::all()[$name] ?? null;
        if (!is_int($value)) {
            throw new \UnexpectedValueException("credentials.json holds no integer '{$name}'");
        }

        return $value;
    }

    /** @return array<string, mixed> */
    private static function all(): array
    {
        $contents = file_get_contents(base_path('credentials.json'));
        if ($contents === false) {
            throw new \RuntimeException('credentials.json cannot be read: assemble.sh copies it beside composer.json');
        }

        /** @var array<string, mixed> */
        return json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
    }
}
