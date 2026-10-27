<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\UnexpectedErrorListener;
use App\Generated\TasksService\Laravel\UnexpectedErrorListener as ServiceUnexpectedErrorListener;
use Illuminate\Support\Facades\Log;
use Seampact\Codegen\Runtime\UnexpectedFailure;

/** Logs each unexpected failure of either api as an app's error reporter would; the log-lines route captures the line. */
final class TasksUnexpectedErrors implements UnexpectedErrorListener, ServiceUnexpectedErrorListener
{
    public function onUnexpectedError(UnexpectedFailure $failure): void
    {
        $why = $failure->cause?->getMessage() ?? $failure->reason;
        Log::error("unexpected failure in {$failure->api}." . ($failure->operation ?? '(none)') . ": {$why}");
    }
}
