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
use App\Http\Controllers\AppController;
use App\Http\Controllers\ChannelsController;
use App\Http\Controllers\DraftsController;
use App\Http\Controllers\HooksController;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\PreferencesController;
use App\Http\Controllers\TasksController;
use App\Suite\ChannelResolver;
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
use Seampact\Hooks\IdempotencyStore;

/**
 * Binds the handlers and the hook doubles of the `tasks` and `tasksService` apis, less what the boot variant leaves out, and takes the
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

        if (!BootVariant::is('missing-handler')) {
            $this->app->bind(AppEndpoints::class, AppController::class);
        }
        $this->app->bind(ChannelsEndpoints::class, ChannelsController::class);
        $this->app->bind(DraftsEndpoints::class, DraftsController::class);
        $this->app->bind(HooksEndpoints::class, HooksController::class);
        $this->app->bind(PreferencesEndpoints::class, PreferencesController::class);
        $this->app->bind(TasksEndpoints::class, TasksController::class);

        if (!BootVariant::is('missing-authenticate-hook')) {
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
        $this->app->bind(IdempotencyStore::class, FileIdempotencyStore::class);

        $this->app->bind(InternalEndpoints::class, InternalController::class);
        $this->app->bind(ServiceAuthenticateHook::class, ServiceHook::class);
        $this->app->tag([ServiceDecider::class], TasksServiceSeampactServiceProvider::DECIDERS_TAG);
        $this->app->bind(ServiceUnexpectedErrorListener::class, TasksUnexpectedErrors::class);
    }

    public function boot(): void
    {
        Event::listen(static function (MessageLogged $logged): void {
            SuiteControl::writeLogLine($logged->message);
        });
    }
}
