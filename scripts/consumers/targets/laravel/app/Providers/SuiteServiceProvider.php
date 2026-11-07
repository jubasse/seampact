<?php

declare(strict_types=1);

namespace App\Providers;

use App\Generated\Tasks\AppEndpoints;
use App\Generated\Tasks\ChannelsEndpoints;
use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\HooksEndpoints;
use App\Generated\Tasks\Laravel\StripeAuthenticateHook;
use App\Generated\Tasks\Laravel\TasksSeampactServiceProvider;
use App\Generated\Tasks\Laravel\UnexpectedErrorListener;
use App\Generated\Tasks\Laravel\UserAuthenticateHook;
use App\Generated\Tasks\PreferencesEndpoints;
use App\Generated\Tasks\TasksEndpoints;
use App\Generated\TasksService\InternalEndpoints;
use App\Generated\TasksService\Laravel\ServiceAuthenticateHook;
use App\Generated\TasksService\Laravel\TasksServiceSeampactServiceProvider;
use App\Generated\TasksService\Laravel\UnexpectedErrorListener as ServiceUnexpectedErrorListener;
use App\Generated\TasksAbsoluteUrls\Laravel\UnexpectedErrorListener as AbsoluteUrlsUnexpectedErrorListener;
use App\Generated\TasksAbsoluteUrls\Laravel\UserAuthenticateHook as AbsoluteUrlsUserAuthenticateHook;
use App\Generated\TasksAbsoluteUrls\NotesEndpoints;
use App\Generated\TasksDevices\DevicesEndpoints;
use App\Generated\TasksDevices\Laravel\DeviceAuthenticateHook;
use App\Generated\TasksDevices\Laravel\UnexpectedErrorListener as DevicesUnexpectedErrorListener;
use App\Generated\TasksOptionalAuth\Laravel\UnexpectedErrorListener as OptionalAuthUnexpectedErrorListener;
use App\Generated\TasksOptionalAuth\Laravel\UserAuthenticateHook as OptionalAuthUserAuthenticateHook;
use App\Generated\TasksOptionalAuth\WelcomeEndpoints;
use App\Generated\TasksResponses\Laravel\TasksResponsesSeampactServiceProvider;
use App\Generated\TasksResponses\Laravel\UnexpectedErrorListener as ResponsesUnexpectedErrorListener;
use App\Generated\TasksResponses\Laravel\UserAuthenticateHook as ResponsesUserAuthenticateHook;
use App\Generated\TasksResponses\MemosEndpoints as ResponsesMemosEndpoints;
use App\Generated\TasksResponses\NotesEndpoints as ResponsesNotesEndpoints;
use App\Generated\TasksResponses\ResponsesEndpoints;
use App\Generated\TasksServiceWrites\InternalWritesEndpoints;
use App\Generated\TasksServiceWrites\Laravel\ServiceAuthenticateHook as WritesServiceAuthenticateHook;
use App\Generated\TasksServiceWrites\Laravel\TasksServiceWritesSeampactServiceProvider;
use App\Generated\TasksServiceWrites\Laravel\UnexpectedErrorListener as ServiceWritesUnexpectedErrorListener;
use App\Http\Controllers\AppController;
use App\Http\Controllers\ChannelsController;
use App\Http\Controllers\DevicesController;
use App\Http\Controllers\DraftsController;
use App\Http\Controllers\HooksController;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\InternalWritesController;
use App\Http\Controllers\NotesController;
use App\Http\Controllers\PreferencesController;
use App\Http\Controllers\ResponsesController;
use App\Http\Controllers\ResponsesMemosController;
use App\Http\Controllers\ResponsesNotesController;
use App\Http\Controllers\TasksController;
use App\Http\Controllers\WelcomeController;
use App\Suite\ChannelResolver;
use App\Suite\DeviceHook;
use App\Suite\OverriddenRightDecider;
use App\Suite\ServiceDecider;
use App\Suite\ServiceHook;
use App\Suite\StripeHook;
use App\Suite\TasksDecider;
use App\Suite\TasksUnexpectedErrors;
use App\Suite\UserHook;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Seampact\ConsumerSuite\BootVariant;
use Seampact\ConsumerSuite\FileIdempotencyStore;
use Seampact\ConsumerSuite\SuiteControl;
use Seampact\ConsumerSuite\SuiteFiles;

/**
 * Binds the handlers and the hook doubles of every api, less what the boot variant leaves out, and takes the
 * api's `responses` mode from `SEAMPACT_SUITE_RESPONSES` and `app.debug` from `SEAMPACT_SUITE_APP_DEBUG` when they
 * are set, at run time so a config cache keeps them.
 */
final class SuiteServiceProvider extends ServiceProvider
{
    private const RESPONSES_VARIABLE = 'SEAMPACT_SUITE_RESPONSES';
    private const APP_DEBUG_VARIABLE = 'SEAMPACT_SUITE_APP_DEBUG';
    private const CONTROL_STATE_FILE = 'suite-control.json';
    private const CREDENTIALS_FILE = 'credentials.json';
    // Sanctum's guard reads the `web` session guard first; the app has no database, so its sessions live in memory.
    private const SESSION_DRIVER = 'array';
    // The web group's cookie encryption, which Sanctum's CSRF cookie route runs, needs a key; this one guards nothing.
    private const SUITE_APP_KEY = 'base64:c3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3M=';

    public function register(): void
    {
        SuiteFiles::configure(storage_path(self::CONTROL_STATE_FILE), base_path(self::CREDENTIALS_FILE));
        $this->app->make('config')->set('session.driver', self::SESSION_DRIVER);
        $this->app->make('config')->set('app.key', self::SUITE_APP_KEY);

        $responses = getenv(self::RESPONSES_VARIABLE);
        if (is_string($responses) && $responses !== '') {
            $this->app->make('config')->set('seampact.tasks.responses', $responses);
        }
        if (getenv(self::APP_DEBUG_VARIABLE) === 'true') {
            $this->app->make('config')->set('app.debug', true);
        }

        if (!BootVariant::leavesOutHealthHandler()) {
            $this->app->bind(AppEndpoints::class, AppController::class);
        }
        $this->app->bind(ChannelsEndpoints::class, ChannelsController::class);
        $this->app->bind(DraftsEndpoints::class, DraftsController::class);
        $this->app->bind(HooksEndpoints::class, HooksController::class);
        $this->app->bind(PreferencesEndpoints::class, PreferencesController::class);
        $this->app->bind(TasksEndpoints::class, TasksController::class);

        if (!BootVariant::leavesOutAuthenticateHook()) {
            $this->app->bind(UserAuthenticateHook::class, UserHook::class);
        }
        $this->app->bind(StripeAuthenticateHook::class, StripeHook::class);
        if (!BootVariant::is('missing-decider')) {
            $this->app->tag([OverriddenRightDecider::class, TasksDecider::class], TasksSeampactServiceProvider::DECIDERS_TAG);
        }
        if (!BootVariant::is('missing-scope-resolver')) {
            $this->app->tag([ChannelResolver::class], TasksSeampactServiceProvider::SCOPE_RESOLVERS_TAG);
        }
        $this->app->bind(UnexpectedErrorListener::class, TasksUnexpectedErrors::class);
        $this->app->bind(TasksSeampactServiceProvider::IDEMPOTENCY_STORE_KEY, FileIdempotencyStore::class);

        $this->app->bind(InternalEndpoints::class, InternalController::class);
        $this->app->bind(ServiceAuthenticateHook::class, ServiceHook::class);
        $this->app->tag([ServiceDecider::class], TasksServiceSeampactServiceProvider::DECIDERS_TAG);
        $this->app->bind(ServiceUnexpectedErrorListener::class, TasksUnexpectedErrors::class);

        $this->app->bind(InternalWritesEndpoints::class, InternalWritesController::class);
        $this->app->bind(WritesServiceAuthenticateHook::class, ServiceHook::class);
        $this->app->tag([ServiceDecider::class], TasksServiceWritesSeampactServiceProvider::DECIDERS_TAG);
        $this->app->bind(TasksServiceWritesSeampactServiceProvider::IDEMPOTENCY_STORE_KEY, FileIdempotencyStore::class);
        $this->app->bind(ServiceWritesUnexpectedErrorListener::class, TasksUnexpectedErrors::class);

        $this->app->bind(DevicesEndpoints::class, DevicesController::class);
        $this->app->bind(DeviceAuthenticateHook::class, DeviceHook::class);
        $this->app->bind(DevicesUnexpectedErrorListener::class, TasksUnexpectedErrors::class);

        $this->app->bind(WelcomeEndpoints::class, WelcomeController::class);
        $this->app->bind(OptionalAuthUserAuthenticateHook::class, UserHook::class);
        $this->app->bind(OptionalAuthUnexpectedErrorListener::class, TasksUnexpectedErrors::class);

        $this->app->bind(NotesEndpoints::class, NotesController::class);
        $this->app->bind(AbsoluteUrlsUserAuthenticateHook::class, UserHook::class);
        $this->app->bind(AbsoluteUrlsUnexpectedErrorListener::class, TasksUnexpectedErrors::class);

        $this->app->bind(ResponsesEndpoints::class, ResponsesController::class);
        $this->app->bind(ResponsesNotesEndpoints::class, ResponsesNotesController::class);
        $this->app->bind(ResponsesMemosEndpoints::class, ResponsesMemosController::class);
        $this->app->bind(ResponsesUserAuthenticateHook::class, UserHook::class);
        $this->app->bind(TasksResponsesSeampactServiceProvider::IDEMPOTENCY_STORE_KEY, FileIdempotencyStore::class);
        $this->app->bind(ResponsesUnexpectedErrorListener::class, TasksUnexpectedErrors::class);
    }

    public function boot(): void
    {
        Event::listen(static function (MessageLogged $logged): void {
            SuiteControl::writeLogLine($logged->message);
        });
    }
}
