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
use Seampact\Laravel\Runtime\KindMiddleware;

// The contract routes of api 'tasks'; require this file inside the route group that serves them.
Route::get('/v1/health', [AppEndpoints::class, 'health'])->name('seampact.tasks.health')->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'public')])->withoutMiddleware(PreventRequestForgery::class);
Route::get('/v1/me/preferences', [PreferencesEndpoints::class, 'getPreferences'])->name('seampact.tasks.getPreferences')->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::post('/v1/hooks/payments', [HooksEndpoints::class, 'payments'])->name('seampact.tasks.payments')->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'signed')])->withoutMiddleware(PreventRequestForgery::class);
Route::get('/v1/channels/{channelId}', [ChannelsEndpoints::class, 'getChannel'])->name('seampact.tasks.getChannel')->where(['channelId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::get('/v1/me/drafts/{draftId}', [DraftsEndpoints::class, 'getDraft'])->name('seampact.tasks.getDraft')->where(['draftId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::post('/v1/channels/{channelId}/tasks', [TasksEndpoints::class, 'createTask'])->name('seampact.tasks.createTask')->where(['channelId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::get('/v1/channels/{channelId}/tasks', [TasksEndpoints::class, 'listTasks'])->name('seampact.tasks.listTasks')->where(['channelId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::post('/v1/channels/{channelId}/tasks/batch', [TasksEndpoints::class, 'getTasksBatch'])->name('seampact.tasks.getTasksBatch')->where(['channelId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::post('/v1/channels/{channelId}/tasks/search', [TasksEndpoints::class, 'searchTasks'])->name('seampact.tasks.searchTasks')->where(['channelId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::get('/v1/channels/{channelId}/tasks/{taskId}', [TasksEndpoints::class, 'getTask'])->name('seampact.tasks.getTask')->where(['channelId' => '[^/]++', 'taskId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::patch('/v1/channels/{channelId}/tasks/{taskId}', [TasksEndpoints::class, 'updateTask'])->name('seampact.tasks.updateTask')->where(['channelId' => '[^/]++', 'taskId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
Route::post('/v1/channels/{channelId}/tasks/{taskId}/purge', [TasksEndpoints::class, 'purgeTask'])->name('seampact.tasks.purgeTask')->where(['channelId' => '[^/]++', 'taskId' => '[^/]++'])->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of('tasks', 'identity')]);
