<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\AppRuleName;
use Symfony\Component\Validator\ConstraintViolationInterface;

/**
 * The name an app input rule gives its violation (ADR 0028 "Per family"): the constraint's `payload['rule']`, else a
 * code the rule set with `setCode()`, else the short class name of a custom constraint, first letter lowered. A
 * built-in constraint, an anonymous class and a violation whose code is Symfony's own UUID have no name of their own.
 */
final class AppConstraintName
{
    private const BUILT_IN_NAMESPACE = 'Symfony\\Component\\Validator\\Constraints\\';
    private const ANONYMOUS_CLASS_MARK = '@anonymous';

    private function __construct()
    {
    }

    public static function of(ConstraintViolationInterface $violation): ?string
    {
        $constraint = $violation->getConstraint();
        $payload = $constraint?->payload;
        $named = is_array($payload) ? ($payload[Rule::PAYLOAD_KEY] ?? null) : null;
        if (is_string($named)) {
            return $named;
        }

        $code = $violation->getCode();
        if (is_string($code) && $code !== '' && !AppRuleName::isUuidShaped($code)) {
            return $code;
        }

        return $constraint === null ? null : self::classShortName($constraint::class);
    }

    private static function classShortName(string $class): ?string
    {
        if (str_starts_with($class, self::BUILT_IN_NAMESPACE) || str_contains($class, self::ANONYMOUS_CLASS_MARK)) {
            return null;
        }

        $separator = strrpos($class, '\\');

        return lcfirst($separator === false ? $class : substr($class, $separator + 1));
    }
}
