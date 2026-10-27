<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\ListChannelsRequest;
use App\Generated\Tasks\ListTasksRequest;
use App\Generated\Tasks\ListChannelsResponse200;
use App\Generated\Tasks\ListChannelsResult;
use App\Generated\Tasks\ListTasksResponse200;
use App\Generated\Tasks\ListTasksResult;
use Illuminate\Pagination\LengthAwarePaginator;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/**
 * The paged lists of the pack-laravel contract, paged by Laravel: the handler reads the page and `per_page` the
 * boundary validated and answers a `LengthAwarePaginator` (ADR 0023 "Paging"). It replaces the reference variant's file.
 */
final class PagedLists
{
    private const SAMPLE_TOTAL = 3;
    private const FIRST_PAGE = 1;

    private function __construct()
    {
    }

    public static function listChannels(ListChannelsRequest $request): ListChannelsResult
    {
        $query = $request->contractInput()->query;
        $channels = [SampleData::channel(SampleData::GENERAL_CHANNEL_ID)];

        return new ListChannelsResponse200(new LengthAwarePaginator($channels, count($channels), $query->perPage ?? count($channels), $query->page ?? self::FIRST_PAGE));
    }

    public static function listTasks(ListTasksRequest $request): ListTasksResult
    {
        $query = $request->contractInput()->query;
        $perPage = $query->perPage ?? self::SAMPLE_TOTAL;
        $page = $query->page ?? self::FIRST_PAGE;

        return ScriptedAnswers::answer(
            'listTasks',
            200,
            static function (array $body) use ($perPage, $page): ListTasksResult {
                $items = array_map(SampleData::taskOf(...), is_array($body['items'] ?? null) ? array_values(array_filter($body['items'], is_array(...))) : []);

                return new ListTasksResponse200(new LengthAwarePaginator($items, is_int($body['total'] ?? null) ? $body['total'] : count($items), $perPage, $page));
            },
        ) ?? new ListTasksResponse200(new LengthAwarePaginator([SampleData::task(SampleData::NEW_TASK_ID)], self::SAMPLE_TOTAL, $perPage, $page));
    }
}
