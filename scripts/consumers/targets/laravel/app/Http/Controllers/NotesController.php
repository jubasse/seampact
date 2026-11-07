<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksAbsoluteUrls\GetNoteRequest;
use App\Generated\TasksAbsoluteUrls\GetNoteResponse200;
use App\Generated\TasksAbsoluteUrls\GetNoteResult;
use App\Generated\TasksAbsoluteUrls\ListNotesRequest;
use App\Generated\TasksAbsoluteUrls\ListNotesResult;
use App\Generated\TasksAbsoluteUrls\NotesEndpoints;
use Seampact\ConsumerSuite\SampleData;

/** The `tasksAbsoluteUrls` api's controller; the boundary writes its page links from the configured public origin. */
final class NotesController implements NotesEndpoints
{
    public function listNotes(ListNotesRequest $request): ListNotesResult
    {
        return PagedLists::listNotes($request);
    }

    public function getNote(GetNoteRequest $request): GetNoteResult
    {
        return new GetNoteResponse200(SampleData::note($request->contractInput()->path->noteId));
    }
}
