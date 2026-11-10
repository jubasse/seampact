<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Notes\CreateNoteRequest;
use App\Generated\Notes\CreateNoteResponse201;
use App\Generated\Notes\CreateNoteResult;
use App\Generated\Notes\DeleteNoteRequest;
use App\Generated\Notes\DeleteNoteResponse204;
use App\Generated\Notes\DeleteNoteErrors;
use App\Generated\Notes\DeleteNoteResult;
use App\Generated\Notes\GetNoteErrors;
use App\Generated\Notes\GetNoteRequest;
use App\Generated\Notes\GetNoteResponse200;
use App\Generated\Notes\GetNoteResult;
use App\Generated\Notes\ListNotesPage;
use App\Generated\Notes\ListNotesRequest;
use App\Generated\Notes\ListNotesResponse200;
use App\Generated\Notes\ListNotesResult;
use App\Generated\Notes\NotesEndpoints;
use App\Notes\NoteStore;

final class NotesController implements NotesEndpoints
{
    private const DEFAULT_PAGE_SIZE = 50;

    public function __construct(private readonly NoteStore $notes)
    {
    }

    public function createNote(CreateNoteRequest $request): CreateNoteResult
    {
        $body = $request->contractInput()->body;

        return new CreateNoteResponse201($this->notes->add($body->title, $body->body));
    }

    public function deleteNote(DeleteNoteRequest $request): DeleteNoteResult
    {
        return $this->notes->delete($request->contractInput()->path->noteId)
            ? new DeleteNoteResponse204()
            : DeleteNoteErrors::apiNotFound();
    }

    public function getNote(GetNoteRequest $request): GetNoteResult
    {
        $note = $this->notes->find($request->contractInput()->path->noteId);

        return $note === null ? GetNoteErrors::apiNotFound() : new GetNoteResponse200($note);
    }

    public function listNotes(ListNotesRequest $request): ListNotesResult
    {
        $query = $request->contractInput()->query;
        $offset = (int) ($query->cursor ?? 0);
        $size = $query->limit ?? self::DEFAULT_PAGE_SIZE;
        $notes = $this->notes->all();
        $nextOffset = $offset + $size;

        return new ListNotesResponse200(new ListNotesPage(
            array_slice($notes, $offset, $size),
            $nextOffset < count($notes) ? (string) $nextOffset : null,
        ));
    }
}
