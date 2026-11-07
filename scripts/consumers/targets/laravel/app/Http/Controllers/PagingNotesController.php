<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksPaging\ListNotesPage;
use App\Generated\TasksPaging\ListNotesRequest;
use App\Generated\TasksPaging\ListNotesResponse200;
use App\Generated\TasksPaging\ListNotesResult;
use App\Generated\TasksPaging\NotesEndpoints;
use App\Generated\TasksPaging\Schemas\Note;

/**
 * The `tasksPaging` api's Stripe-style list: the first note with more to come, then the second one, the last, and the
 * first one again before the second.
 */
final class PagingNotesController implements NotesEndpoints
{
    private const FIRST_NOTE_ID = '30000000-0000-4000-8000-000000000001';
    private const SECOND_NOTE_ID = '30000000-0000-4000-8000-000000000002';

    public function listNotes(ListNotesRequest $request): ListNotesResult
    {
        if ($request->contractInput()->query->endingBefore === self::SECOND_NOTE_ID) {
            return new ListNotesResponse200(new ListNotesPage([new Note(self::FIRST_NOTE_ID, 'Before the second note')], false));
        }

        if ($request->contractInput()->query->startingAfter === self::FIRST_NOTE_ID) {
            return new ListNotesResponse200(new ListNotesPage([new Note(self::SECOND_NOTE_ID, 'Second note')], false));
        }

        return new ListNotesResponse200(new ListNotesPage([new Note(self::FIRST_NOTE_ID, 'First note')], true));
    }
}
