<?php

declare(strict_types=1);

namespace App\Suite\Rules;

use App\Generated\InputRules\Schemas\ScheduleTask;
use App\Generated\InputRules\Symfony\InputRulesInputRules;
use Seampact\Symfony\Runtime\Rule;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints\Callback;
use Symfony\Component\Validator\Context\ExecutionContextInterface;

/** The rules of the body of `scheduleTask`. */
final class ScheduleTaskBodyRules implements InputRulesInputRules
{
    public const UNNAMED_NOTE = 'unnamed';
    private const MAX_DAYS = 90;
    private const SECONDS_PER_DAY = 86400;

    public function operationId(): string
    {
        return 'scheduleTask';
    }

    public function part(): string
    {
        return 'body';
    }

    /** @return array<Constraint> */
    public function constraints(): array
    {
        return [new EndAfterStart(), self::windowTooLong(), self::unnamedNoteRule()];
    }

    // It runs on the whole body, so its issue points at the root, and its payload names it.
    private static function windowTooLong(): Callback
    {
        return new Callback(
            callback: static function (ScheduleTask $window, ExecutionContextInterface $context): void {
                $days = (strtotime($window->end) - strtotime($window->start)) / self::SECONDS_PER_DAY;
                if ($days > self::MAX_DAYS) {
                    $context->buildViolation('The window is longer than 90 days.')->addViolation();
                }
            },
            payload: Rule::payload('windowTooLong'),
        );
    }

    // A callback with no payload and no code is a built-in constraint with no name: the suite checks that it answers `app.invalid`.
    private static function unnamedNoteRule(): Callback
    {
        return new Callback(static function (ScheduleTask $window, ExecutionContextInterface $context): void {
            if ($window->note === self::UNNAMED_NOTE) {
                $context->buildViolation('The note is refused.')->addViolation();
            }
        });
    }
}
