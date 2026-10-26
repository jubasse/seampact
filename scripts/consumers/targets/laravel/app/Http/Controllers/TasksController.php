<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\GetTaskErrors;
use App\Generated\Tasks\GetTaskResponse200;
use App\Generated\Tasks\GetTaskResult;
use App\Generated\Tasks\GetTasksBatchResponse200;
use App\Generated\Tasks\GetTasksBatchResult;
use App\Generated\Tasks\Laravel\GetTaskRequest;
use App\Generated\Tasks\Laravel\GetTasksBatchRequest;
use App\Generated\Tasks\TasksEndpoints;
use App\Suite\SampleData;
use App\Suite\ScriptedAnswers;

final class TasksController implements TasksEndpoints
{
    public function getTask(GetTaskRequest $request): GetTaskResult
    {
        return ScriptedAnswers::answer(
            'getTask',
            200,
            static fn (array $body): GetTaskResult => new GetTaskResponse200(SampleData::taskOf($body)),
            ['api.not_found' => static fn (): GetTaskResult => GetTaskErrors::apiNotFound()],
        ) ?? new GetTaskResponse200(SampleData::task($request->contractInput()->path->taskId));
    }

    public function getTasksBatch(GetTasksBatchRequest $request): GetTasksBatchResult
    {
        $tasks = [];
        foreach ($request->contractInput()->body->ids as $taskId) {
            $tasks[$taskId] = SampleData::task($taskId);
        }

        return new GetTasksBatchResponse200($tasks);
    }
}
