<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksResponses\DigestRequest;
use App\Generated\TasksResponses\DigestResponse200;
use App\Generated\TasksResponses\DigestResult;
use App\Generated\TasksResponses\ResponsesEndpoints;
use App\Generated\TasksResponses\Schemas\Note;

/** The `tasksResponses` api's public digest. */
final class ResponsesController implements ResponsesEndpoints
{
    public function digest(DigestRequest $request): DigestResult
    {
        return new DigestResponse200(new Note(ResponsesNotesController::NOTE_ID, "Today's digest", ResponsesNotesController::FIRST_REVISION));
    }
}
