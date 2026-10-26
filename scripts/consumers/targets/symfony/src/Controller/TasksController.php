<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\ArchiveTaskErrors;
use App\Generated\Tasks\ArchiveTaskInput;
use App\Generated\Tasks\ArchiveTaskResponse200;
use App\Generated\Tasks\ArchiveTaskResult;
use App\Generated\Tasks\AssignTaskInput;
use App\Generated\Tasks\AssignTaskResponse200;
use App\Generated\Tasks\AssignTaskResult;
use App\Generated\Tasks\CreateTaskInput;
use App\Generated\Tasks\CreateTaskResponse201;
use App\Generated\Tasks\CreateTaskResult;
use App\Generated\Tasks\GetTaskErrors;
use App\Generated\Tasks\GetTaskInput;
use App\Generated\Tasks\GetTaskResponse200;
use App\Generated\Tasks\GetTaskResult;
use App\Generated\Tasks\GetTasksBatchInput;
use App\Generated\Tasks\GetTasksBatchResponse200;
use App\Generated\Tasks\GetTasksBatchResult;
use App\Generated\Tasks\ListTasksInput;
use App\Generated\Tasks\ListTasksResult;
use App\Generated\Tasks\PurgeTaskInput;
use App\Generated\Tasks\PurgeTaskResponse204;
use App\Generated\Tasks\PurgeTaskResult;
use App\Generated\Tasks\Schemas\Task;
use App\Generated\Tasks\Schemas\TaskSearchResult;
use App\Generated\Tasks\Schemas\TaskState;
use App\Generated\Tasks\SearchTasksInput;
use App\Generated\Tasks\SearchTasksResponse200;
use App\Generated\Tasks\SearchTasksResult;
use App\Generated\Tasks\Symfony\Runtime\SeampactOperation;
use App\Generated\Tasks\TasksEndpoints;
use App\Generated\Tasks\UpdateTaskErrors;
use App\Generated\Tasks\UpdateTaskInput;
use App\Generated\Tasks\UpdateTaskResponse200;
use App\Generated\Tasks\UpdateTaskResult;
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

    #[SeampactOperation('createTask')]
    public function createTask(CreateTaskInput $input): CreateTaskResult
    {
        $created = SampleData::task(SampleData::NEW_TASK_ID);

        return new CreateTaskResponse201(new Task($created->taskId, $input->body->title, $created->state, $created->effort, $created->version, $created->createdAt));
    }

    #[SeampactOperation('updateTask')]
    public function updateTask(UpdateTaskInput $input): UpdateTaskResult
    {
        $input = $input;
        // Every task is at its first version, so another expected version is stale.
        if ($input->body->expectedVersion !== SampleData::FIRST_VERSION) {
            return UpdateTaskErrors::stateConflict();
        }
        $current = SampleData::task($input->path->taskId);

        return new UpdateTaskResponse200(self::withNextVersion($current, $input->body->title ?? $current->title, $current->state));
    }

    #[SeampactOperation('assignTask')]
    public function assignTask(AssignTaskInput $input): AssignTaskResult
    {
        return new AssignTaskResponse200(SampleData::task($input->path->taskId));
    }

    #[SeampactOperation('archiveTask')]
    public function archiveTask(ArchiveTaskInput $input): ArchiveTaskResult
    {
        $input = $input;
        if ($input->body->expectedVersion !== SampleData::FIRST_VERSION) {
            return ArchiveTaskErrors::stateConflict();
        }
        $current = SampleData::task($input->path->taskId);

        return new ArchiveTaskResponse200(self::withNextVersion($current, $current->title, TaskState::Archived));
    }

    #[SeampactOperation('purgeTask')]
    public function purgeTask(PurgeTaskInput $input): PurgeTaskResult
    {
        return new PurgeTaskResponse204();
    }

    // The first page links a second one; the second is the last.
    #[SeampactOperation('listTasks')]
    public function listTasks(ListTasksInput $input): ListTasksResult
    {
        return PagedLists::listTasks($input);
    }

    private static function withNextVersion(Task $current, string $title, TaskState $state): Task
    {
        return new Task($current->taskId, $title, $state, $current->effort, $current->version + 1, $current->createdAt);
    }

    #[SeampactOperation('searchTasks')]
    public function searchTasks(SearchTasksInput $input): SearchTasksResult
    {
        return new SearchTasksResponse200(new TaskSearchResult([SampleData::task(SampleData::NEW_TASK_ID)], 1));
    }
}
