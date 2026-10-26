<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\GetTaskErrors;
use App\Generated\Tasks\GetTaskInput;
use App\Generated\Tasks\GetTaskResponse200;
use App\Generated\Tasks\GetTaskResult;
use App\Generated\Tasks\GetTasksBatchInput;
use App\Generated\Tasks\GetTasksBatchResponse200;
use App\Generated\Tasks\GetTasksBatchResult;
use App\Generated\Tasks\Symfony\Runtime\SeampactOperation;
use App\Generated\Tasks\TasksEndpoints;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

final class TasksController implements TasksEndpoints
{
    #[SeampactOperation('getTask')]
    public function getTask(GetTaskInput $input): GetTaskResult
    {
        return ScriptedAnswers::answer(
            'getTask',
            200,
            static fn (array $body): GetTaskResult => new GetTaskResponse200(SampleData::taskOf($body)),
            ['api.not_found' => static fn (): GetTaskResult => GetTaskErrors::apiNotFound()],
        ) ?? new GetTaskResponse200(SampleData::task($input->path->taskId));
    }

    #[SeampactOperation('getTasksBatch')]
    public function getTasksBatch(GetTasksBatchInput $input): GetTasksBatchResult
    {
        $tasks = [];
        foreach ($input->body->ids as $taskId) {
            $tasks[$taskId] = SampleData::task($taskId);
        }

        return new GetTasksBatchResponse200($tasks);
    }
}
