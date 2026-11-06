<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\Tasks\ListChannelsInput;
use App\Generated\Tasks\ListTasksInput;
use App\Generated\Tasks\ListChannelsPage;
use App\Generated\Tasks\ListChannelsResponse200;
use App\Generated\Tasks\ListChannelsResult;
use App\Generated\Tasks\ListTasksPage;
use App\Generated\Tasks\ListTasksResponse200;
use App\Generated\Tasks\ListTasksResult;
use App\Generated\Tasks\Schemas\Task;
use App\Generated\Tasks\Schemas\TaskState;
use App\Generated\TasksAbsoluteUrls\ListNotesInput;
use App\Generated\TasksAbsoluteUrls\ListNotesPage;
use App\Generated\TasksAbsoluteUrls\ListNotesResponse200;
use App\Generated\TasksAbsoluteUrls\ListNotesResult;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/** The paged lists of the reference contract, answered with the generated page classes. */
final class PagedLists
{
    private const NEXT_CURSOR = 'page-2';

    private function __construct()
    {
    }

    public static function listChannels(ListChannelsInput $input): ListChannelsResult
    {
        return new ListChannelsResponse200(new ListChannelsPage([SampleData::channel(SampleData::GENERAL_CHANNEL_ID)]));
    }

    public static function listTasks(ListTasksInput $input): ListTasksResult
    {
        $nextCursor = $input->query->cursor === null ? self::NEXT_CURSOR : null;

        return ScriptedAnswers::answer(
            'listTasks',
            200,
            static fn (array $body): ListTasksResult => new ListTasksResponse200(new ListTasksPage(
                array_map(SampleData::taskOf(...), is_array($body['items'] ?? null) ? array_values(array_filter($body['items'], is_array(...))) : []),
                is_string($body['nextCursor'] ?? null) ? $body['nextCursor'] : null,
            )),
        ) ?? new ListTasksResponse200(new ListTasksPage(self::sampleTasks($input->query->state), $nextCursor));
    }

    /**
     * The sample tasks in the states the client filters on, else the one new task.
     *
     * @param list<TaskState>|null $states
     * @return list<Task>
     */
    private static function sampleTasks(?array $states): array
    {
        return $states === null ? [SampleData::task(SampleData::NEW_TASK_ID)] : SampleData::tasksInStates($states);
    }

    public static function listNotes(ListNotesInput $input): ListNotesResult
    {
        $nextCursor = $input->query->cursor === null ? self::NEXT_CURSOR : null;

        return new ListNotesResponse200(new ListNotesPage([SampleData::note(SampleData::FIRST_NOTE_ID)], $nextCursor));
    }
}
