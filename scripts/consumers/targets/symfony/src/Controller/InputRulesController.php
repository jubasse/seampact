<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\InputRules\AppEndpoints as InputRulesAppEndpoints;
use App\Generated\InputRules\ScheduleTaskInput;
use App\Generated\InputRules\ScheduleTaskResponse201;
use App\Generated\InputRules\ScheduleTaskResult;
use App\Generated\InputRules\Schemas\ScheduledTask;
use App\Generated\InputRules\Symfony\SeampactOperation;

/** The `inputRules` api's controller: it schedules the window the app's input rules let through. */
final class InputRulesController implements InputRulesAppEndpoints
{
    private const SCHEDULED_TASK_ID = '40000000-0000-4000-8000-000000000001';

    #[SeampactOperation('scheduleTask')]
    public function scheduleTask(ScheduleTaskInput $input): ScheduleTaskResult
    {
        return new ScheduleTaskResponse201(new ScheduledTask(self::SCHEDULED_TASK_ID, $input->body->start, $input->body->end));
    }
}
