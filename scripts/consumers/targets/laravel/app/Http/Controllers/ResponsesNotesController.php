<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksResponses\ApiPreconditionFailedError;
use App\Generated\TasksResponses\GetNoteRequest;
use App\Generated\TasksResponses\GetNoteResponse200;
use App\Generated\TasksResponses\GetNoteResult;
use App\Generated\TasksResponses\KeyNoteRequest;
use App\Generated\TasksResponses\KeyNoteResponse200;
use App\Generated\TasksResponses\KeyNoteResult;
use App\Generated\TasksResponses\LegacyNoteRequest;
use App\Generated\TasksResponses\LegacyNoteResponse200;
use App\Generated\TasksResponses\LegacyNoteResult;
use App\Generated\TasksResponses\NotesEndpoints;
use App\Generated\TasksResponses\SaveNoteRequest;
use App\Generated\TasksResponses\SaveNoteResponse200;
use App\Generated\TasksResponses\SaveNoteResponse201;
use App\Generated\TasksResponses\SaveNoteResult;
use App\Generated\TasksResponses\Schemas\Note;
use App\Generated\TasksResponses\Schemas\NoteKey;
use App\Generated\TasksResponses\UpdateNoteRequest;
use App\Generated\TasksResponses\UpdateNoteResponse200;
use App\Generated\TasksResponses\UpdateNoteResult;
use Seampact\ConsumerSuite\SampleData;
use Seampact\ConsumerSuite\ScriptedAnswers;

/**
 * The `tasksResponses` api's notes: one note at its first revision, saved as 200 when it exists and 201 otherwise,
 * and the If-Match comparison the boundary leaves to the handler.
 */
final class ResponsesNotesController implements NotesEndpoints
{
    public const NOTE_ID = '30000000-0000-4000-8000-000000000001';
    public const FIRST_REVISION = 1;

    private const API = 'tasksResponses';
    private const FIRST_NOTE_TEXT = 'The first note';
    private const NOTE_SECRET = 'note-secret';

    public function getNote(GetNoteRequest $request): GetNoteResult
    {
        return new GetNoteResponse200(new Note($request->contractInput()->path->noteId, self::FIRST_NOTE_TEXT, self::FIRST_REVISION));
    }

    public function updateNote(UpdateNoteRequest $request): UpdateNoteResult
    {
        $input = $request->contractInput();
        // The boundary hands the If-Match version unquoted (`1` for `"1"` or `W/"1"`).
        if ($input->headers->ifMatch !== (string) self::FIRST_REVISION) {
            throw new ApiPreconditionFailedError();
        }

        return new UpdateNoteResponse200(new Note($input->path->noteId, $input->body->text, self::FIRST_REVISION + 1));
    }

    public function saveNote(SaveNoteRequest $request): SaveNoteResult
    {
        $input = $request->contractInput();
        $saved = new Note($input->path->noteId, $input->body->text, self::FIRST_REVISION);

        return $input->path->noteId === self::NOTE_ID ? new SaveNoteResponse200($saved) : new SaveNoteResponse201($saved);
    }

    public function keyNote(KeyNoteRequest $request): KeyNoteResult
    {
        $noteId = $request->contractInput()->path->noteId;
        $scripted = static fn (array $body): KeyNoteResult => new KeyNoteResponse200(new NoteKey(SampleData::text($body, 'noteId'), SampleData::text($body, 'secret')));

        return ScriptedAnswers::answer('keyNote', 200, $scripted, api: self::API)
            ?? new KeyNoteResponse200(new NoteKey($noteId, self::NOTE_SECRET));
    }

    public function legacyNote(LegacyNoteRequest $request): LegacyNoteResult
    {
        return new LegacyNoteResponse200(new Note($request->contractInput()->path->noteId, self::FIRST_NOTE_TEXT, self::FIRST_REVISION));
    }
}
