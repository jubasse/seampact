<?php

declare(strict_types=1);

namespace App\Providers;

use App\Generated\Notes\Laravel\NotesSeampactServiceProvider;
use App\Generated\Notes\NotesEndpoints;
use App\Http\Controllers\NotesController;
use App\Rules\CreateNoteBodyRules;
use Illuminate\Support\ServiceProvider;

final class NotesServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(NotesEndpoints::class, NotesController::class);
        $this->app->tag([CreateNoteBodyRules::class], NotesSeampactServiceProvider::INPUT_RULES_TAG);
    }
}
