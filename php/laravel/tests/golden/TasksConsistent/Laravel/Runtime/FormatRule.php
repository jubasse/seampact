<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * A string member's portable format: `date-time` (RFC 3339, with its offset), which Laravel has no rule for, and
 * `uuid`. Under `rules: native` a `uuid` member has Laravel's `uuid` rule and this one checks only the empty and
 * whitespace-only strings, which Laravel's rule skips.
 */
final class FormatRule extends ContractRule
{
    public const DATE_TIME = 'date-time';
    public const UUID = 'uuid';

    private const DATE_TIME_PATTERN = '/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/D';
    private const UUID_PATTERN = '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/D';
    private const LAST_HOUR = 23;
    private const LAST_MINUTE = 59;
    private const LAST_SECOND = 60;

    public function __construct(InputTree $input, Position $position, private readonly string $format, private readonly BlankStrings $checked)
    {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->presentValue($attribute);

        if (!is_string($found->value) || ($this->checked === BlankStrings::BlankOnly && trim($found->value) !== '')) {
            return;
        }

        if (!$this->matches($found->value)) {
            $this->failWith($attribute, 'format', $fail);
        }
    }

    private function matches(string $text): bool
    {
        return match ($this->format) {
            self::UUID => preg_match(self::UUID_PATTERN, $text) === 1,
            self::DATE_TIME => self::isDateTime($text),
            default => throw new \LogicException("The generated format rule names the unknown format '{$this->format}'."),
        };
    }

    private static function isDateTime(string $text): bool
    {
        if (preg_match(self::DATE_TIME_PATTERN, $text, $parts) !== 1) {
            return false;
        }

        $offsetHour = $parts[9] ?? '00';
        $offsetMinute = $parts[10] ?? '00';

        return checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
            && (int) $parts[4] <= self::LAST_HOUR && (int) $parts[5] <= self::LAST_MINUTE && (int) $parts[6] <= self::LAST_SECOND
            && (int) $offsetHour <= self::LAST_HOUR && (int) $offsetMinute <= self::LAST_MINUTE;
    }
}
