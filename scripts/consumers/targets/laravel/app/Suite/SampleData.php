<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Schemas\Channel;
use App\Generated\Tasks\Schemas\Draft;
use App\Generated\Tasks\Schemas\Task;
use App\Generated\Tasks\Schemas\TaskState;

/** The values the handlers answer without a script, and the scripted bodies read into the generated types. */
final class SampleData
{
    private const CREATED_AT = '2026-10-18T09:00:00.000Z';
    public const FIRST_VERSION = 1;
    public const NEW_TASK_ID = '20000000-0000-4000-8000-0000000000ff';

    private function __construct()
    {
    }

    public static function task(string $taskId): Task
    {
        return new Task($taskId, 'Write the slice test', TaskState::Open, null, self::FIRST_VERSION, new \DateTimeImmutable(self::CREATED_AT));
    }

    public static function channel(string $channelId): Channel
    {
        return new Channel($channelId, 'General');
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
