<?php

declare(strict_types=1);

namespace App\Providers;

use App\Generated\TasksPaging\CappedEndpoints as PagingCappedEndpoints;
use App\Generated\TasksPaging\Laravel\UnexpectedErrorListener as PagingUnexpectedErrorListener;
use App\Generated\TasksPaging\Laravel\UserAuthenticateHook as PagingUserAuthenticateHook;
use App\Generated\TasksPaging\NotesEndpoints as PagingNotesEndpoints;
use App\Generated\TasksSplitSort\Laravel\UnexpectedErrorListener as SplitSortUnexpectedErrorListener;
use App\Generated\TasksSplitSort\Laravel\UserAuthenticateHook as SplitSortUserAuthenticateHook;
use App\Generated\TasksSplitSort\NotesEndpoints as SplitSortNotesEndpoints;
use App\Http\Controllers\PagingCappedController;
use App\Http\Controllers\PagingNotesController;
use App\Http\Controllers\SplitSortNotesController;
use App\Suite\PagingUnexpectedErrors;
use App\Suite\PagingUserHook;
use Illuminate\Support\ServiceProvider;

/** Binds the handlers and the hook doubles of the `tasksPaging` and `tasksSplitSort` apis. */
final class PagingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PagingNotesEndpoints::class, PagingNotesController::class);
        $this->app->bind(PagingCappedEndpoints::class, PagingCappedController::class);
        $this->app->bind(PagingUserAuthenticateHook::class, PagingUserHook::class);
        $this->app->bind(PagingUnexpectedErrorListener::class, PagingUnexpectedErrors::class);

        $this->app->bind(SplitSortNotesEndpoints::class, SplitSortNotesController::class);
        $this->app->bind(SplitSortUserAuthenticateHook::class, PagingUserHook::class);
        $this->app->bind(SplitSortUnexpectedErrorListener::class, PagingUnexpectedErrors::class);
    }
}
