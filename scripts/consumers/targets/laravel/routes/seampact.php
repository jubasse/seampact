<?php

declare(strict_types=1);

use App\Http\Controllers\SuiteControlController;
use App\Http\Controllers\UnlistedRouteController;
use Illuminate\Support\Facades\Route;
use Seampact\ConsumerSuite\BootVariant;

// The mount-mismatch boot variant serves the tasks api under a route group prefix its entry's mount does not state.
if (BootVariant::mountsUnderMismatchedPrefix()) {
    Route::prefix(BootVariant::MISMATCHED_MOUNT)->group(static fn () => Route::seampact('tasks'));
} else {
    Route::seampact('tasks');
}
Route::seampact('tasksService');
Route::seampact('tasksServiceWrites');
Route::seampact('tasksDevices');
Route::seampact('tasksOptionalAuth');
Route::seampact('tasksAbsoluteUrls');
Route::seampact('tasksResponses');
Route::seampact('tasksPaging');
Route::seampact('tasksSplitSort');
Route::seampact('inputRules');

// The suite's control routes (ADR 0015 "Control routes"), allow-listed in seampact.config.yaml.
Route::put('/__seampact/script', [SuiteControlController::class, 'loadScript']);
Route::get('/__seampact/hook-calls', [SuiteControlController::class, 'hookCalls']);
Route::get('/__seampact/log-lines', [SuiteControlController::class, 'logLines']);
Route::get('/__seampact/dumped-credential', [SuiteControlController::class, 'dumpedCredential']);

if (BootVariant::servesUnlistedRoute()) {
    Route::get('/v1/unlisted', UnlistedRouteController::class);
}

if (BootVariant::servesPatternedRoute()) {
    Route::get(BootVariant::PATTERNED_ROUTE, UnlistedRouteController::class);
}
