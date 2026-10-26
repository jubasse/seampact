<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/** The contract rule names an input issue carries (ADR 0003), the `rule` of `{ in, pointer, rule }`. */
final class Rule
{
    public const REQUIRED = 'required';
    public const TYPE = 'type';
    public const UNKNOWN_KEYS = 'unknownKeys';
    public const ENUM = 'enum';
    public const MIN_LENGTH = 'minLength';
    public const MAX_LENGTH = 'maxLength';
    public const PATTERN = 'pattern';
    public const FORMAT = 'format';
    public const MINIMUM = 'minimum';
    public const MAXIMUM = 'maximum';
    public const EXCLUSIVE_MINIMUM = 'exclusiveMinimum';
    public const EXCLUSIVE_MAXIMUM = 'exclusiveMaximum';
    public const MULTIPLE_OF = 'multipleOf';
    public const MIN_ITEMS = 'minItems';
    public const MAX_ITEMS = 'maxItems';

    /** The key of a constraint's `payload` that holds its contract rule. */
    public const PAYLOAD_KEY = 'rule';

    private function __construct()
    {
    }

    /** @return array{rule: string} the `payload` of a Symfony constraint that checks `$rule` */
    public static function payload(string $rule): array
    {
        return [self::PAYLOAD_KEY => $rule];
    }
}
