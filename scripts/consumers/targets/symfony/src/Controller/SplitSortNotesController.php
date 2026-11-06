<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksSplitSort\ListNotesPage;
use App\Generated\TasksSplitSort\ListNotesInput;
use App\Generated\TasksSplitSort\ListNotesResponse200;
use App\Generated\TasksSplitSort\ListNotesResult;
use App\Generated\TasksSplitSort\NotesEndpoints;
use App\Generated\TasksSplitSort\Schemas\Note;
use App\Generated\TasksSplitSort\Symfony\SeampactOperation;

/** The `tasksSplitSort` api's GitHub-style pages, whose note's text tells the sort and the page size received. */
final class SplitSortNotesController implements NotesEndpoints
{
    private const FIRST_NOTE_ID = '30000000-0000-4000-8000-000000000001';
    private const CREATED = '2026-10-18T09:00:00Z';
    // Three pages of 100, so a page size above the maximum served as sent would link no next page.
    private const TOTAL = 250;

    #[SeampactOperation('listNotes')]
    public function listNotes(ListNotesInput $input): ListNotesResult
    {
        $query = $input->query;
        $text = ($query->sort ?? 'none') . ' ' . ($query->direction ?? 'none') . ', ' . ($query->perPage ?? 'none') . ' per page';

        return new ListNotesResponse200(new ListNotesPage([new Note(self::FIRST_NOTE_ID, $text, new \DateTimeImmutable(self::CREATED))], self::TOTAL));
    }
}
