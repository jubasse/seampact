<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Illuminate\Support\ServiceProvider;

/** Registers the seampact artisan commands; Laravel's package discovery lists it from `extra.laravel.providers`. */
final class SeampactCommandsProvider extends ServiceProvider
{
    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->commands([GenerateCommand::class]);
        }
    }
}
