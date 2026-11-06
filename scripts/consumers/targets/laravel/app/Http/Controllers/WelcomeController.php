<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksOptionalAuth\GreetingRequest;
use App\Generated\TasksOptionalAuth\GreetingResponse200;
use App\Generated\TasksOptionalAuth\GreetingResult;
use App\Generated\TasksOptionalAuth\Schemas\Greeting;
use App\Generated\TasksOptionalAuth\StrictGreetingRequest;
use App\Generated\TasksOptionalAuth\StrictGreetingResponse200;
use App\Generated\TasksOptionalAuth\StrictGreetingResult;
use App\Generated\TasksOptionalAuth\WelcomeEndpoints;

/** The `tasksOptionalAuth` api's controller: a caller is signed in when the boundary hands it a principal. */
final class WelcomeController implements WelcomeEndpoints
{
    public function greeting(GreetingRequest $request): GreetingResult
    {
        return new GreetingResponse200(new Greeting($request->principal() !== null));
    }

    public function strictGreeting(StrictGreetingRequest $request): StrictGreetingResult
    {
        return new StrictGreetingResponse200(new Greeting($request->principal() !== null));
    }
}
