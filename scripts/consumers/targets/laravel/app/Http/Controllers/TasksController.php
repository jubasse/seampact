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
use App\Generated\Tasks\GetTaskPath;
use App\Generated\Tasks\GetTaskResponse200;
use App\Generated\Tasks\GetTaskResult;
use App\Generated\Tasks\GetTasksBatchResponse200;
use App\Generated\Tasks\GetTasksBatchResult;
use App\Generated\Tasks\ArchiveTaskRequest;
use App\Generated\Tasks\AssignTaskRequest;
use App\Generated\Tasks\CreateTaskRequest;
use App\Generated\Tasks\GetTaskRequest;
use App\Generated\Tasks\GetTasksBatchRequest;
use App\Generated\Tasks\ListTasksRequest;
use App\Generated\Tasks\PurgeTaskRequest;
use App\Generated\Tasks\SearchTasksRequest;
use App\Generated\Tasks\Laravel\TasksRouteNames;
use App\Generated\Tasks\Laravel\TasksUrls;
use App\Generated\Tasks\UpdateTaskRequest;
use App\Generated\Tasks\ListTasksResult;
use App\Generated\Tasks\PurgeTaskResponse204;
use App\Generated\Tasks\PurgeTaskResult;
use App\Generated\Tasks\SearchTasksResponse200;
use App\Generated\Tasks\SearchTasksResult;
use App\Generated\Tasks\Schemas\Task;
use App\Generated\Tasks\Schemas\TaskSearchResult;
use App\Generated\Tasks\Schemas\TaskState;
use App\Generated\Tasks\TasksEndpoints;
use App\Generated\Tasks\UpdateTaskErrors;
use App\Generated\Tasks\UpdateTaskResponse200;
use App\Generated\Tasks\UpdateTaskResult;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/** The tasks endpoints; `getTask` also checks the route helpers against the router. */
final class TasksController implements TasksEndpoints
{
    public function getTask(GetTaskRequest $request): GetTaskResult
    {
        return ScriptedAnswers::answer(
            'getTask',
            200,
            static fn (array $body): GetTaskResult => new GetTaskResponse200(SampleData::taskOf($body)),
            ['api.not_found' => static fn (): GetTaskResult => GetTaskErrors::apiNotFound()],
        ) ?? new GetTaskResponse200(SampleData::task(self::checkedTaskPath($request)->taskId));
    }

    // The route helpers build the path this request came on, as `route()` builds it from the route name.
    private static function checkedTaskPath(GetTaskRequest $request): GetTaskPath
    {
        $path = $request->contractInput()->path;
        $built = TasksUrls::getTask($path->channelId, $path->taskId);
        $routed = route(TasksRouteNames::GET_TASK, ['channelId' => $path->channelId, 'taskId' => $path->taskId], false);
        if ($built !== $request->getPathInfo() || $built !== $routed) {
            throw new \LogicException("TasksUrls::getTask built '{$built}', route() '{$routed}', for the request path '{$request->getPathInfo()}'.");
        }

        return $path;
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

    // The first page links a second one; the second is the last.
    public function listTasks(ListTasksRequest $request): ListTasksResult
    {
        return PagedLists::listTasks($request);
    }

    private static function withNextVersion(Task $current, string $title, TaskState $state): Task
    {
        return new Task($current->taskId, $title, $state, $current->effort, $current->version + 1, $current->createdAt);
    }

    public function searchTasks(SearchTasksRequest $request): SearchTasksResult
    {
        return new SearchTasksResponse200(new TaskSearchResult([SampleData::task(SampleData::NEW_TASK_ID)], 1));
    }
}
