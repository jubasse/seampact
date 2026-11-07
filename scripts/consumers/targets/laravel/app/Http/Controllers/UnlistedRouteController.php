<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\Response;

/** The framework route outside the contract that the framework-route boot variants serve. */
final class UnlistedRouteController
{
    public function __invoke(): Response
    {
        return new Response('unlisted', 200, ['Content-Type' => 'text/plain']);
    }
}
