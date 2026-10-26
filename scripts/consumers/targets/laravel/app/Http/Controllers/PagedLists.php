<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\Laravel\ListChannelsRequest;
use App\Generated\Tasks\Laravel\ListTasksRequest;
use App\Generated\Tasks\ListChannelsPage;
use App\Generated\Tasks\ListChannelsResponse200;
use App\Generated\Tasks\ListChannelsResult;
use App\Generated\Tasks\ListTasksPage;
use App\Generated\Tasks\ListTasksResponse200;
use App\Generated\Tasks\ListTasksResult;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/** The paged lists of the reference contract, answered with the generated page classes; the pack-laravel variant replaces this file. */
final class PagedLists
{
    private const NEXT_CURSOR = 'page-2';

    private function __construct()
    {
    }

    public static function listChannels(ListChannelsRequest $request): ListChannelsResult
    {
        return new ListChannelsResponse200(new ListChannelsPage([SampleData::channel(SampleData::GENERAL_CHANNEL_ID)]));
    }

    public static function listTasks(ListTasksRequest $request): ListTasksResult
    {
        $nextCursor = $request->contractInput()->query->cursor === null ? self::NEXT_CURSOR : null;

        return ScriptedAnswers::answer(
            'listTasks',
            200,
            static fn (array $body): ListTasksResult => new ListTasksResponse200(new ListTasksPage(
                array_map(SampleData::taskOf(...), is_array($body['items'] ?? null) ? array_values(array_filter($body['items'], is_array(...))) : []),
                is_string($body['nextCursor'] ?? null) ? $body['nextCursor'] : null,
            )),
        ) ?? new ListTasksResponse200(new ListTasksPage([SampleData::task(SampleData::NEW_TASK_ID)], $nextCursor));
    }
}
