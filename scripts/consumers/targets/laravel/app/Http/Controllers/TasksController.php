<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\ArchiveTaskErrors;
use App\Generated\Tasks\ArchiveTaskResponse200;
use App\Generated\Tasks\ArchiveTaskResult;
use App\Generated\Tasks\AssignTaskResponse200;
use App\Generated\Tasks\AssignTaskResult;
use App\Generated\Tasks\CreateTaskResponse201;
use App\Generated\Tasks\CreateTaskResult;
use App\Generated\Tasks\GetTaskErrors;
use App\Generated\Tasks\GetTaskResponse200;
use App\Generated\Tasks\GetTaskResult;
use App\Generated\Tasks\GetTasksBatchResponse200;
use App\Generated\Tasks\GetTasksBatchResult;
use App\Generated\Tasks\Laravel\ArchiveTaskRequest;
use App\Generated\Tasks\Laravel\AssignTaskRequest;
use App\Generated\Tasks\Laravel\CreateTaskRequest;
use App\Generated\Tasks\Laravel\GetTaskRequest;
use App\Generated\Tasks\Laravel\GetTasksBatchRequest;
use App\Generated\Tasks\Laravel\PurgeTaskRequest;
use App\Generated\Tasks\Laravel\UpdateTaskRequest;
use App\Generated\Tasks\PurgeTaskResponse204;
use App\Generated\Tasks\PurgeTaskResult;
use App\Generated\Tasks\Schemas\Task;
use App\Generated\Tasks\Schemas\TaskState;
use App\Generated\Tasks\TasksEndpoints;
use App\Generated\Tasks\UpdateTaskErrors;
use App\Generated\Tasks\UpdateTaskResponse200;
use App\Generated\Tasks\UpdateTaskResult;
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

    public function createTask(CreateTaskRequest $request): CreateTaskResult
    {
        $created = SampleData::task(SampleData::NEW_TASK_ID);

        return new CreateTaskResponse201(new Task($created->taskId, $request->contractInput()->body->title, $created->state, $created->effort, $created->version, $created->createdAt));
    }

    public function updateTask(UpdateTaskRequest $request): UpdateTaskResult
    {
        $input = $request->contractInput();
        // Every task is at its first version, so another expected version is stale.
        if ($input->body->expectedVersion !== SampleData::FIRST_VERSION) {
            return UpdateTaskErrors::stateConflict();
        }
        $current = SampleData::task($input->path->taskId);

        return new UpdateTaskResponse200(self::withNextVersion($current, $input->body->title ?? $current->title, $current->state));
    }

    public function assignTask(AssignTaskRequest $request): AssignTaskResult
    {
        return new AssignTaskResponse200(SampleData::task($request->contractInput()->path->taskId));
    }

    public function archiveTask(ArchiveTaskRequest $request): ArchiveTaskResult
    {
        $input = $request->contractInput();
        if ($input->body->expectedVersion !== SampleData::FIRST_VERSION) {
            return ArchiveTaskErrors::stateConflict();
        }
        $current = SampleData::task($input->path->taskId);

        return new ArchiveTaskResponse200(self::withNextVersion($current, $current->title, TaskState::Archived));
    }

    public function purgeTask(PurgeTaskRequest $request): PurgeTaskResult
    {
        return new PurgeTaskResponse204();
    }

    private static function withNextVersion(Task $current, string $title, TaskState $state): Task
    {
        return new Task($current->taskId, $title, $state, $current->effort, $current->version + 1, $current->createdAt);
    }
}
