<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksService\ApiDeadlineExceededError;
use App\Generated\TasksService\GetTaskResponse200;
use App\Generated\TasksService\GetTaskResult;
use App\Generated\TasksService\InternalEndpoints;
use App\Generated\TasksService\Laravel\GetTaskRequest;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/** The `tasksService` api's controller; stopping the work once the deadline has passed is the handler's part. */
final class InternalController implements InternalEndpoints
{
    private const API = 'tasksService';

    public function getTask(GetTaskRequest $request): GetTaskResult
    {
        $input = $request->contractInput();
        // An unparseable deadline is no deadline, as the Node sample handler reads it, never a 500.
        $deadline = date_create_immutable($input->headers->xDeadline);
        if ($deadline !== false && $deadline <= new \DateTimeImmutable()) {
            throw new ApiDeadlineExceededError();
        }

        return ScriptedAnswers::answer(
            'getTask',
            200,
            static fn (array $body): GetTaskResult => new GetTaskResponse200(SampleData::serviceTaskOf($body)),
            [],
            self::API,
        ) ?? new GetTaskResponse200(SampleData::serviceTask($input->path->taskId));
    }
}
