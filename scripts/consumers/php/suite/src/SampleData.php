<?php

declare(strict_types=1);

namespace Seampact\ConsumerSuite;

use App\Generated\Tasks\Schemas\Channel;
use App\Generated\Tasks\Schemas\Draft;
use App\Generated\Tasks\Schemas\Task;
use App\Generated\Tasks\Schemas\TaskState;
use App\Generated\TasksAbsoluteUrls\Schemas\Note;
use App\Generated\TasksService\Schemas\Task as ServiceTask;
use App\Generated\TasksService\Schemas\TaskState as ServiceTaskState;
use App\Generated\TasksServiceWrites\Schemas\Task as RelayedTask;
use App\Generated\TasksServiceWrites\Schemas\TaskState as RelayedTaskState;
use Seampact\Hooks\ResolvedScope;

/** The values the handlers answer without a script, and the scripted bodies read into the generated types. */
final class SampleData
{
    private const CREATED_AT = '2026-10-18T09:00:00.000Z';
    public const FIRST_VERSION = 1;
    public const NEW_TASK_ID = '20000000-0000-4000-8000-0000000000ff';
    private const SEEDED_TASK_ID = '20000000-0000-4000-8000-%012d';
    public const GENERAL_CHANNEL_ID = '10000000-0000-4000-8000-000000000001';
    /** The channel the sample user is not a member of: its scope resolver denies it, so no handler runs for it. */
    public const NON_MEMBER_CHANNEL_ID = '10000000-0000-4000-8000-0000000000ff';
    public const FIRST_NOTE_ID = '40000000-0000-4000-8000-000000000001';

    private function __construct()
    {
    }

    public static function task(string $taskId): Task
    {
        return new Task($taskId, 'Write the slice test', TaskState::Open, null, self::FIRST_VERSION, new \DateTimeImmutable(self::CREATED_AT));
    }

    /**
     * The tasks a listTasks call answers: with no state filter the one new task; else the sample tasks whose state is
     * one of `$states`, in seed order, since the channel holds one task in each state.
     *
     * @param list<TaskState>|null $states
     * @return list<Task>
     */
    public static function listedTasks(?array $states): array
    {
        if ($states === null) {
            return [self::task(self::NEW_TASK_ID)];
        }

        $seeded = [];
        foreach (TaskState::cases() as $index => $state) {
            $seeded[] = new Task(sprintf(self::SEEDED_TASK_ID, $index + 1), 'Write the slice test', $state, null, self::FIRST_VERSION, new \DateTimeImmutable(self::CREATED_AT));
        }

        return array_values(array_filter($seeded, static fn (Task $task): bool => in_array($task->state, $states, true)));
    }

    public static function serviceTask(string $taskId): ServiceTask
    {
        return new ServiceTask($taskId, 'Write the slice test', ServiceTaskState::Open, null, self::FIRST_VERSION, new \DateTimeImmutable(self::CREATED_AT));
    }

    /** The task a service's relayed write creates, as the `tasksServiceWrites` api types it. */
    public static function relayedTask(string $title, ?int $effort): RelayedTask
    {
        return new RelayedTask(self::NEW_TASK_ID, $title, RelayedTaskState::Open, $effort, self::FIRST_VERSION, new \DateTimeImmutable(self::CREATED_AT));
    }

    public static function note(string $noteId): Note
    {
        return new Note($noteId, 'Read the slice notes');
    }

    /** @param array<mixed> $body */
    public static function serviceTaskOf(array $body): ServiceTask
    {
        $task = self::taskOf($body);

        return new ServiceTask($task->taskId, $task->title, ServiceTaskState::from($task->state->value), $task->effort, $task->version, $task->createdAt);
    }

    public static function channel(string $channelId): Channel
    {
        return new Channel($channelId, 'General');
    }

    /**
     * The channel the scope resolver loaded, as the handler of a channel operation reads it with its caller's id: the
     * consumer proves the principal and the scopes reach the handler without a second lookup.
     */
    public static function loadedChannel(ResolvedScope $scope, string $callerId): Channel
    {
        if ($callerId === '') {
            throw new \LogicException("the handler of scope '{$scope->scope}' read no caller id from its principal");
        }

        return $scope->value instanceof Channel ? $scope->value : throw new \LogicException("the resolver of scope '{$scope->scope}' loaded no channel for the handler");
    }

    public static function draft(string $draftId): Draft
    {
        return new Draft($draftId, 'Draft text');
    }

    /** @param array<mixed> $body */
    public static function taskOf(array $body): Task
    {
        $effort = $body['effort'] ?? null;

        return new Task(
            self::text($body, 'taskId'),
            self::text($body, 'title'),
            TaskState::from(self::text($body, 'state')),
            is_int($effort) ? $effort : null,
            is_int($body['version'] ?? null) ? $body['version'] : self::FIRST_VERSION,
            new \DateTimeImmutable(self::text($body, 'createdAt')),
        );
    }

    /** @param array<mixed> $body */
    public static function channelOf(array $body): Channel
    {
        return new Channel(self::text($body, 'channelId'), self::text($body, 'name'));
    }

    /** @param array<mixed> $body */
    public static function text(array $body, string $member): string
    {
        $value = $body[$member] ?? null;
        if (!is_string($value)) {
            throw new \UnexpectedValueException("the scripted body holds no text '{$member}'");
        }

        return $value;
    }
}
