<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\Tasks\Laravel\Runtime\UnexpectedErrorListener;
use App\Generated\Tasks\Laravel\Runtime\UnexpectedFailure;
use Illuminate\Support\Facades\Log;

/** Logs each unexpected failure as an app's error reporter would; the log-lines route captures the line. */
final class TasksUnexpectedErrors implements UnexpectedErrorListener
{
    public function onUnexpectedError(UnexpectedFailure $failure): void
    {
        $why = $failure->cause?->getMessage() ?? $failure->reason;
        Log::error("unexpected failure in {$failure->api}." . ($failure->operation ?? '(none)') . ": {$why}");
    }
}
