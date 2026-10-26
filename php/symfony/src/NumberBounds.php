<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Codegen\IrPlace;
use Seampact\Codegen\Refusals;
use Seampact\Ir\Model\Refinements;

/** The number bounds of a member (`minimum` and the like) and the Symfony comparison constraint that checks each. */
final class NumberBounds
{
    /** The Symfony constraint of each bound, one per bound and never `Range`, so each violation carries its own rule. */
    public const CONSTRAINTS = [
        'minimum' => 'GreaterThanOrEqual',
        'maximum' => 'LessThanOrEqual',
        'exclusiveMinimum' => 'GreaterThan',
        'exclusiveMaximum' => 'LessThan',
    ];
    private const DECIMAL_LITERAL = '/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/D';

    private function __construct()
    {
    }

    /**
     * The bounds of `$refinements` by rule, each a decimal literal PHP reads as a number; one that is not is refused
     * at `$at` and left out.
     *
     * @return array<string, string>
     */
    public static function of(Refinements $refinements, IrPlace $at, Refusals $refusals): array
    {
        $declared = [
            'minimum' => $refinements->minimum,
            'maximum' => $refinements->maximum,
            'exclusiveMinimum' => $refinements->exclusiveMinimum,
            'exclusiveMaximum' => $refinements->exclusiveMaximum,
        ];

        $bounds = [];
        foreach ($declared as $rule => $decimal) {
            if ($decimal === null) {
                continue;
            }
            if (preg_match(self::DECIMAL_LITERAL, $decimal) !== 1) {
                $refusals->inconsistent('ir.value.invalid', "The {$rule} '{$decimal}' is not a decimal number", $at->below('refinements', $rule));
                continue;
            }

            $bounds[$rule] = $decimal;
        }

        return $bounds;
    }
}
