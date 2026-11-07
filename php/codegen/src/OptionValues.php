<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The raw options of one target entry, read key by key: an unknown key, or a value outside its set, is refused by
 * name at `/options/<key>`, and a key left out gives its default.
 */
final class OptionValues
{
    /** @var array<string, mixed> */
    private array $values = [];

    /** @param list<string> $knownKeys every key the target takes */
    public function __construct(\stdClass $raw, private readonly string $target, array $knownKeys, private readonly Refusals $refusals)
    {
        // A numeric option name decodes to an integer key; it is still a name.
        foreach (get_object_vars($raw) as $key => $value) {
            $this->values[(string) $key] = $value;
        }

        foreach (array_keys($this->values) as $key) {
            if (!in_array($key, $knownKeys, true)) {
                $this->refuse('options.unknown', (string) $key, "The option '{$key}' is not one the {$this->target} target knows; it takes '" . implode("', '", $knownKeys) . "'.", "Remove '{$key}' from the target's `options`.");
            }
        }
    }

    public function target(): string
    {
        return $this->target;
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->values);
    }

    public function value(string $key): mixed
    {
        return $this->values[$key] ?? null;
    }

    /**
     * The case named by the option, `$default` when it is left out, or null once refused.
     *
     * @template T of \BackedEnum
     * @param T $default
     * @return T|null
     */
    public function choice(string $key, \BackedEnum $default): ?\BackedEnum
    {
        if (!$this->has($key)) {
            return $default;
        }

        $value = $this->values[$key];
        foreach ($default::cases() as $case) {
            if ($case->value === $value) {
                return $case;
            }
        }

        $allowed = array_map(static fn (\BackedEnum $case): string => (string) $case->value, $default::cases());
        $this->refuse("options.{$key}.invalid", $key, "The option '{$key}' is " . self::shown($value) . ", not one of '" . implode("', '", $allowed) . "'.", "Set '{$key}' to '{$default->value}' (the default) or another listed value.");

        return null;
    }

    /** The option's boolean, `$default` when it is left out, or null once refused. */
    public function flag(string $key, bool $default): ?bool
    {
        if (!$this->has($key)) {
            return $default;
        }

        if (is_bool($this->values[$key])) {
            return $this->values[$key];
        }

        $this->refuse("options.{$key}.invalid", $key, "The option '{$key}' is " . self::shown($this->values[$key]) . ', not true or false.', "Set '{$key}' to true or false (the default is " . ($default ? 'true' : 'false') . ').');

        return null;
    }

    public function refuse(string $code, string $key, string $message, string $fix): void
    {
        $this->refusals->add($code, $message, $fix, IrPlace::root()->below('options', $key));
    }

    public static function shown(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION) ?: get_debug_type($value);
    }
}
