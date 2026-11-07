<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksPaging\ListNotesPage;
use App\Generated\TasksPaging\ListNotesInput;
use App\Generated\TasksPaging\ListNotesResponse200;
use App\Generated\TasksPaging\ListNotesResult;
use App\Generated\TasksPaging\NotesEndpoints;
use App\Generated\TasksPaging\Schemas\Note;
use App\Generated\TasksPaging\Symfony\SeampactOperation;

/**
 * The `tasksPaging` api's Stripe-style list: the first note with more to come, then the second one, the last, and the
 * first one again before the second.
 */
final class PagingNotesController implements NotesEndpoints
{
    private const FIRST_NOTE_ID = '30000000-0000-4000-8000-000000000001';
    private const SECOND_NOTE_ID = '30000000-0000-4000-8000-000000000002';

    #[SeampactOperation('listNotes')]
    public function listNotes(ListNotesInput $input): ListNotesResult
    {
        if ($input->query->endingBefore === self::SECOND_NOTE_ID) {
            return new ListNotesResponse200(new ListNotesPage([new Note(self::FIRST_NOTE_ID, 'Before the second note')], false));
        }

        if ($input->query->startingAfter === self::FIRST_NOTE_ID) {
            return new ListNotesResponse200(new ListNotesPage([new Note(self::SECOND_NOTE_ID, 'Second note')], false));
        }

        return new ListNotesResponse200(new ListNotesPage([new Note(self::FIRST_NOTE_ID, 'First note')], true));
    }
}
