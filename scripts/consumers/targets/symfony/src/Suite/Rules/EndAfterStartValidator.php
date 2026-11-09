<?php

declare(strict_types=1);

namespace App\Suite\Rules;

use App\Generated\InputRules\Schemas\ScheduleTask;
use Seampact\ConsumerSuite\SuiteControl;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/** Checks the end of a window against its start, and records the call so the case sees the rule ran. */
final class EndAfterStartValidator extends ConstraintValidator
{
    private const HOOK = 'input-rule:endAfterStart';

    public function validate(mixed $value, Constraint $constraint): void
    {
        SuiteControl::recordHookCall(self::HOOK, 'inputRules', 'scheduleTask');
        SuiteControl::throwScriptedHookFailure(self::HOOK);

        if ($value instanceof ScheduleTask && $value->end <= $value->start) {
            $this->context->buildViolation('The end must come after the start.')->atPath('end')->addViolation();
        }
    }
}
