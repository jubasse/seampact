<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\UnexpectedErrorListener;
use App\Generated\TasksAbsoluteUrls\Laravel\UnexpectedErrorListener as AbsoluteUrlsUnexpectedErrorListener;
use App\Generated\TasksDevices\Laravel\UnexpectedErrorListener as DevicesUnexpectedErrorListener;
use App\Generated\TasksOptionalAuth\Laravel\UnexpectedErrorListener as OptionalAuthUnexpectedErrorListener;
use App\Generated\TasksResponses\Laravel\UnexpectedErrorListener as ResponsesUnexpectedErrorListener;
use App\Generated\TasksService\Laravel\UnexpectedErrorListener as ServiceUnexpectedErrorListener;
use App\Generated\TasksServiceWrites\Laravel\UnexpectedErrorListener as ServiceWritesUnexpectedErrorListener;
use Illuminate\Support\Facades\Log;
use Seampact\Codegen\Runtime\UnexpectedFailure;

/** Logs each unexpected failure of every api as an app's error reporter would; the log-lines route captures the line. */
final class TasksUnexpectedErrors implements
    UnexpectedErrorListener,
    ServiceUnexpectedErrorListener,
    ServiceWritesUnexpectedErrorListener,
    DevicesUnexpectedErrorListener,
    OptionalAuthUnexpectedErrorListener,
    AbsoluteUrlsUnexpectedErrorListener,
    ResponsesUnexpectedErrorListener
{
    public function onUnexpectedError(UnexpectedFailure $failure): void
    {
        $why = $failure->cause?->getMessage() ?? $failure->reason;
        Log::error("unexpected failure in {$failure->api}." . ($failure->operation ?? '(none)') . ": {$why}");
    }
}
