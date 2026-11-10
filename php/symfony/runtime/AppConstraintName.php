<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\AppRuleName;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintViolationInterface;

/**
 * The name an app input rule gives its violation (ADR 0028 "Per family"): the payload `rule` of the constraint that
 * raised it, else a usable code the rule set with `setCode()`, else the short class name of that custom constraint,
 * first letter lowered. A violation raised by a built-in inside a composite (`All`, `Sequentially`, a `Compound`) takes
 * the name of the top-level constraint the app wrote. A built-in constraint, an anonymous class and a violation whose
 * code is Symfony's own UUID have no name of their own.
 */
final class AppConstraintName
{
    private const BUILT_IN_NAMESPACE = 'Symfony\\Component\\Validator\\Constraints\\';
    private const ANONYMOUS_CLASS_MARK = '@anonymous';

    private function __construct()
    {
    }

    /** @param ?Constraint $topLevel the constraint of the rule set the violation came from, which names a violation its own constraint cannot */
    public static function of(ConstraintViolationInterface $violation, ?Constraint $topLevel = null): ?string
    {
        $constraint = $violation->getConstraint();
        $named = $constraint === null ? null : self::payloadName($constraint);
        if ($named !== null) {
            return $named;
        }

        $code = $violation->getCode();
        if (is_string($code) && AppRuleName::isUsable($code)) {
            return $code;
        }

        return self::classShortName($constraint) ?? ($topLevel === null ? null : self::payloadName($topLevel) ?? self::classShortName($topLevel));
    }

    private static function payloadName(Constraint $constraint): ?string
    {
        $payload = $constraint->payload;
        $named = is_array($payload) ? ($payload[Rule::PAYLOAD_KEY] ?? null) : null;

        return is_string($named) ? $named : null;
    }

    private static function classShortName(?Constraint $constraint): ?string
    {
        if ($constraint === null) {
            return null;
        }

        $class = $constraint::class;
        if (str_starts_with($class, self::BUILT_IN_NAMESPACE) || str_contains($class, self::ANONYMOUS_CLASS_MARK)) {
            return null;
        }

        $separator = strrpos($class, '\\');

        return lcfirst($separator === false ? $class : substr($class, $separator + 1));
    }
}
