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
use App\Generated\TasksAbsoluteUrls\ListNotesInput;
use App\Generated\TasksAbsoluteUrls\ListNotesPage;
use App\Generated\TasksAbsoluteUrls\ListNotesResponse200;
use App\Generated\TasksAbsoluteUrls\ListNotesResult;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/**
 * The paged lists of the pack-laravel contract: the handler answers the page's items and the total its paging style
 * asks for, and the boundary writes Laravel's page links and meta. It replaces the reference variant's file.
 */
final class PagedLists
{
    private const SAMPLE_TOTAL = 3;

    private function __construct()
    {
    }

    public static function listChannels(ListChannelsInput $input): ListChannelsResult
    {
        $channels = [SampleData::channel(SampleData::GENERAL_CHANNEL_ID)];

        return new ListChannelsResponse200(new ListChannelsPage($channels, count($channels)));
    }

    public static function listTasks(ListTasksInput $input): ListTasksResult
    {
        return ScriptedAnswers::answer(
            'listTasks',
            200,
            static function (array $body): ListTasksResult {
                $items = array_map(SampleData::taskOf(...), is_array($body['items'] ?? null) ? array_values(array_filter($body['items'], is_array(...))) : []);

                return new ListTasksResponse200(new ListTasksPage($items, is_int($body['total'] ?? null) ? $body['total'] : count($items)));
            },
        ) ?? new ListTasksResponse200(new ListTasksPage([SampleData::task(SampleData::NEW_TASK_ID)], self::SAMPLE_TOTAL));
    }

    public static function listNotes(ListNotesInput $input): ListNotesResult
    {
        $notes = [SampleData::note(SampleData::FIRST_NOTE_ID)];

        return new ListNotesResponse200(new ListNotesPage($notes, count($notes)));
    }
}
