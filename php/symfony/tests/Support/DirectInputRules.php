<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Symfony\Runtime\InputRules;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints\Callback;

/** A rule set that implements the runtime's interface and no api's: no api runs it. */
final class DirectInputRules implements InputRules
{
    public function operationId(): string
    {
        return 'scheduleTask';
    }

    public function part(): string
    {
        return 'body';
    }

    public function constraints(): Constraint
    {
        return new Callback(static function (): void {
        });
    }
}
