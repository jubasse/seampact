<?php

declare(strict_types=1);

use App\Http\Controllers\SuiteControlController;
use App\Http\Controllers\UnlistedRouteController;
use Illuminate\Support\Facades\Route;
use Seampact\ConsumerSuite\BootVariant;

Route::seampact('tasks');

// The suite's control routes (ADR 0015 "Control routes"), allow-listed in seampact.config.yaml.
Route::put('/__seampact/script', [SuiteControlController::class, 'loadScript']);
Route::get('/__seampact/hook-calls', [SuiteControlController::class, 'hookCalls']);
Route::get('/__seampact/log-lines', [SuiteControlController::class, 'logLines']);
Route::get('/__seampact/dumped-credential', [SuiteControlController::class, 'dumpedCredential']);

if (BootVariant::servesUnlistedRoute()) {
    Route::get('/v1/unlisted', UnlistedRouteController::class);
}
