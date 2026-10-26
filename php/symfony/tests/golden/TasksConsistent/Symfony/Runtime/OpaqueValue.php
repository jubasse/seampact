<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * An opaque value of the contract, any JSON the body holds: only a number beyond the float range, which decodes to an
 * infinity, breaks its type, anywhere inside it.
 */
final class OpaqueValue
{
    private function __construct()
    {
    }

    public static function isFiniteThroughout(mixed $value): bool
    {
        if (is_float($value)) {
            return is_finite($value);
        }
        if (!is_array($value) && !$value instanceof \stdClass) {
            return true;
        }
        foreach ((array) $value as $member) {
            if (!self::isFiniteThroughout($member)) {
                return false;
            }
        }

        return true;
    }
}
