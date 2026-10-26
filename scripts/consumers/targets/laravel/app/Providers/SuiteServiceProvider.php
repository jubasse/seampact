<?php

declare(strict_types=1);

namespace App\Providers;

use App\Generated\Tasks\AppEndpoints;
use App\Generated\Tasks\ChannelsEndpoints;
use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\Laravel\Runtime\UnexpectedErrorListener;
use App\Generated\Tasks\Laravel\TasksSeampactServiceProvider;
use App\Generated\Tasks\Laravel\UserAuthenticateHook;
use App\Generated\Tasks\TasksEndpoints;
use App\Http\Controllers\AppController;
use App\Http\Controllers\ChannelsController;
use App\Http\Controllers\DraftsController;
use App\Http\Controllers\TasksController;
use App\Suite\BootVariant;
use App\Suite\ChannelResolver;
use App\Suite\SuiteControl;
use App\Suite\TasksDecider;
use App\Suite\TasksUnexpectedErrors;
use App\Suite\UserHook;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

/**
 * Binds the handlers and the hook doubles of the `tasks` api, less what the boot variant leaves out, and takes the
 * api's `responses` mode from `SEAMPACT_SUITE_RESPONSES` when it is set, at run time so a config cache keeps it.
 */
final class SuiteServiceProvider extends ServiceProvider
{
    private const RESPONSES_VARIABLE = 'SEAMPACT_SUITE_RESPONSES';

    public function register(): void
    {
        $responses = getenv(self::RESPONSES_VARIABLE);
        if (is_string($responses) && $responses !== '') {
            $this->app->make('config')->set('seampact.tasks.responses', $responses);
        }

        if (!BootVariant::is('missing-handler')) {
            $this->app->bind(AppEndpoints::class, AppController::class);
        }
        $this->app->bind(ChannelsEndpoints::class, ChannelsController::class);
        $this->app->bind(DraftsEndpoints::class, DraftsController::class);
        $this->app->bind(TasksEndpoints::class, TasksController::class);

        if (!BootVariant::is('missing-authenticate-hook')) {
            $this->app->bind(UserAuthenticateHook::class, UserHook::class);
        }
        if (!BootVariant::is('missing-decider')) {
            $this->app->tag([TasksDecider::class], TasksSeampactServiceProvider::DECIDERS_TAG);
        }
        if (!BootVariant::is('missing-scope-resolver')) {
            $this->app->tag([ChannelResolver::class], TasksSeampactServiceProvider::SCOPE_RESOLVERS_TAG);
        }
        $this->app->bind(UnexpectedErrorListener::class, TasksUnexpectedErrors::class);
    }

    public function boot(): void
    {
        Event::listen(static function (MessageLogged $logged): void {
            SuiteControl::writeLogLine($logged->message);
        });
    }
}
