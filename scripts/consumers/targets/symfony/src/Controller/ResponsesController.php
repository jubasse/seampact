<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksResponses\DigestInput;
use App\Generated\TasksResponses\DigestResponse200;
use App\Generated\TasksResponses\DigestResult;
use App\Generated\TasksResponses\ResponsesEndpoints;
use App\Generated\TasksResponses\Schemas\Note;
use App\Generated\TasksResponses\Symfony\SeampactOperation;

/** The `tasksResponses` api's public digest. */
final class ResponsesController implements ResponsesEndpoints
{
    #[SeampactOperation('digest')]
    public function digest(DigestInput $input): DigestResult
    {
        return new DigestResponse200(new Note(ResponsesNotesController::NOTE_ID, "Today's digest", ResponsesNotesController::FIRST_REVISION));
    }
}
