<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksPaging\CappedEndpoints;
use App\Generated\TasksPaging\ListCappedInput;
use App\Generated\TasksPaging\ListCappedPage;
use App\Generated\TasksPaging\ListCappedResponse200;
use App\Generated\TasksPaging\ListCappedResult;
use App\Generated\TasksPaging\Schemas\Note;
use App\Generated\TasksPaging\Symfony\SeampactOperation;

/** The `tasksPaging` api's clamped list: one note whose text tells the limit the handler received. */
final class PagingCappedController implements CappedEndpoints
{
    private const FIRST_NOTE_ID = '30000000-0000-4000-8000-000000000001';

    #[SeampactOperation('listCapped')]
    public function listCapped(ListCappedInput $input): ListCappedResult
    {
        $limit = $input->query->limit ?? 'none';

        return new ListCappedResponse200(new ListCappedPage([new Note(self::FIRST_NOTE_ID, "limit {$limit}")], false));
    }
}
