<?php

declare(strict_types=1);

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;
use Seampact\Golden\TasksConsistent\AppEndpoints;
use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\DraftsEndpoints;
use Seampact\Golden\TasksConsistent\HooksEndpoints;
use Seampact\Golden\TasksConsistent\Laravel\TasksAccessMiddleware;
use Seampact\Golden\TasksConsistent\PreferencesEndpoints;
use Seampact\Golden\TasksConsistent\TasksEndpoints;

// The contract routes of api 'tasks'; require this file inside the route group that serves them.
Route::get('/v1/health', [AppEndpoints::class, 'health'])->name('seampact.tasks.health')->middleware(TasksAccessMiddleware::class);
Route::get('/v1/me/preferences', [PreferencesEndpoints::class, 'getPreferences'])->name('seampact.tasks.getPreferences')->middleware(TasksAccessMiddleware::class);
Route::post('/v1/hooks/payments', [HooksEndpoints::class, 'payments'])->name('seampact.tasks.payments')->middleware(TasksAccessMiddleware::class)->withoutMiddleware(PreventRequestForgery::class);
Route::get('/v1/channels/{p1}', [ChannelsEndpoints::class, 'getChannel'])->name('seampact.tasks.getChannel')->middleware(TasksAccessMiddleware::class);
Route::get('/v1/me/drafts/{p1}', [DraftsEndpoints::class, 'getDraft'])->name('seampact.tasks.getDraft')->middleware(TasksAccessMiddleware::class);
Route::post('/v1/channels/{p1}/tasks', [TasksEndpoints::class, 'createTask'])->name('seampact.tasks.createTask')->middleware(TasksAccessMiddleware::class);
Route::get('/v1/channels/{p1}/tasks', [TasksEndpoints::class, 'listTasks'])->name('seampact.tasks.listTasks')->middleware(TasksAccessMiddleware::class);
Route::post('/v1/channels/{p1}/tasks/batch', [TasksEndpoints::class, 'getTasksBatch'])->name('seampact.tasks.getTasksBatch')->middleware(TasksAccessMiddleware::class);
Route::post('/v1/channels/{p1}/tasks/search', [TasksEndpoints::class, 'searchTasks'])->name('seampact.tasks.searchTasks')->middleware(TasksAccessMiddleware::class);
Route::get('/v1/channels/{p1}/tasks/{p2}', [TasksEndpoints::class, 'getTask'])->name('seampact.tasks.getTask')->middleware(TasksAccessMiddleware::class);
Route::patch('/v1/channels/{p1}/tasks/{p2}', [TasksEndpoints::class, 'updateTask'])->name('seampact.tasks.updateTask')->middleware(TasksAccessMiddleware::class);
Route::post('/v1/channels/{p1}/tasks/{p2}/purge', [TasksEndpoints::class, 'purgeTask'])->name('seampact.tasks.purgeTask')->middleware(TasksAccessMiddleware::class);
