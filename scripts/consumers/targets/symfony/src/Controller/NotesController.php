<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksAbsoluteUrls\GetNoteInput;
use App\Generated\TasksAbsoluteUrls\GetNoteResponse200;
use App\Generated\TasksAbsoluteUrls\GetNoteResult;
use App\Generated\TasksAbsoluteUrls\ListNotesInput;
use App\Generated\TasksAbsoluteUrls\ListNotesResult;
use App\Generated\TasksAbsoluteUrls\NotesEndpoints;
use App\Generated\TasksAbsoluteUrls\Symfony\SeampactOperation;
use Seampact\ConsumerSuite\SampleData;

/** The `tasksAbsoluteUrls` api's controller; the boundary writes its page links from the configured public origin. */
final class NotesController implements NotesEndpoints
{
    #[SeampactOperation('listNotes')]
    public function listNotes(ListNotesInput $input): ListNotesResult
    {
        return PagedLists::listNotes($input);
    }

    #[SeampactOperation('getNote')]
    public function getNote(GetNoteInput $input): GetNoteResult
    {
        return new GetNoteResponse200(SampleData::note($input->path->noteId));
    }
}
