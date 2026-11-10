<?php

declare(strict_types=1);

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Support\Facades\Route;

// No `web` or `api` group: the contract routes carry the boundary's own middleware.
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(then: static fn () => Route::seampact('notes'))
    ->withExceptions(static function (Exceptions $exceptions): void {
    })
    ->create();
