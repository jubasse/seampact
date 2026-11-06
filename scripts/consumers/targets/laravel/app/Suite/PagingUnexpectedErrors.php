<?php

declare(strict_types=1);

namespace App\Suite;

use App\Generated\TasksPaging\Laravel\UnexpectedErrorListener as PagingUnexpectedErrorListener;
use App\Generated\TasksSplitSort\Laravel\UnexpectedErrorListener as SplitSortUnexpectedErrorListener;
use Illuminate\Support\Facades\Log;
use Seampact\Codegen\Runtime\UnexpectedFailure;

/** Logs each unexpected failure of the paging apis as an app's error reporter would; the log-lines route captures the line. */
final class PagingUnexpectedErrors implements PagingUnexpectedErrorListener, SplitSortUnexpectedErrorListener
{
    public function onUnexpectedError(UnexpectedFailure $failure): void
    {
        $why = $failure->cause?->getMessage() ?? $failure->reason;
        Log::error("unexpected failure in {$failure->api}." . ($failure->operation ?? '(none)') . ": {$why}");
    }
}
