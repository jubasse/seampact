<?php

declare(strict_types=1);

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\JsonResponse;
use Seampact\ConsumerSuite\ScriptedReply;

// No `web` or `api` group: the contract routes carry the boundary's own middleware, and the control routes need none.
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(using: static function (): void {
        require __DIR__ . '/../routes/seampact.php';
    })
    ->withMiddleware(static function (Middleware $middleware): void {
    })
    ->withExceptions(static function (Exceptions $exceptions): void {
        // A scripted reply the result type cannot hold: the app writes it itself, as the script says.
        $exceptions->render(static fn (ScriptedReply $reply): JsonResponse => new JsonResponse($reply->body(), $reply->status(), $reply->headers()));
    })
    ->create();
