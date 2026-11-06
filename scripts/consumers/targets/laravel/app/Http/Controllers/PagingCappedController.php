<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksPaging\CappedEndpoints;
use App\Generated\TasksPaging\ListCappedPage;
use App\Generated\TasksPaging\ListCappedRequest;
use App\Generated\TasksPaging\ListCappedResponse200;
use App\Generated\TasksPaging\ListCappedResult;
use App\Generated\TasksPaging\Schemas\Note;

/** The `tasksPaging` api's clamped list: one note whose text tells the limit the handler received. */
final class PagingCappedController implements CappedEndpoints
{
    private const FIRST_NOTE_ID = '30000000-0000-4000-8000-000000000001';

    public function listCapped(ListCappedRequest $request): ListCappedResult
    {
        $limit = $request->contractInput()->query->limit ?? 'none';

        return new ListCappedResponse200(new ListCappedPage([new Note(self::FIRST_NOTE_ID, "limit {$limit}")], false));
    }
}
