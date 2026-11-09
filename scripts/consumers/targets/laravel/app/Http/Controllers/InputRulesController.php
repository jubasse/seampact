<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\InputRules\AppEndpoints;
use App\Generated\InputRules\ScheduleTaskRequest;
use App\Generated\InputRules\ScheduleTaskResponse201;
use App\Generated\InputRules\ScheduleTaskResult;
use App\Generated\InputRules\Schemas\ScheduledTask;

/** The `inputRules` api's controller: it schedules the window the app's input rules let through. */
final class InputRulesController implements AppEndpoints
{
    private const SCHEDULED_TASK_ID = '40000000-0000-4000-8000-000000000001';

    public function scheduleTask(ScheduleTaskRequest $request): ScheduleTaskResult
    {
        $window = $request->contractInput()->body;

        return new ScheduleTaskResponse201(new ScheduledTask(self::SCHEDULED_TASK_ID, $window->start, $window->end));
    }
}
