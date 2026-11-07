<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksOptionalAuth\GreetingInput;
use App\Generated\TasksOptionalAuth\GreetingResponse200;
use App\Generated\TasksOptionalAuth\GreetingResult;
use App\Generated\TasksOptionalAuth\Schemas\Greeting;
use App\Generated\TasksOptionalAuth\StrictGreetingInput;
use App\Generated\TasksOptionalAuth\StrictGreetingResponse200;
use App\Generated\TasksOptionalAuth\StrictGreetingResult;
use App\Generated\TasksOptionalAuth\Symfony\SeampactOperation;
use App\Generated\TasksOptionalAuth\WelcomeEndpoints;

/** The `tasksOptionalAuth` api's controller: a caller is signed in when the boundary hands it a principal. */
final class WelcomeController implements WelcomeEndpoints
{
    #[SeampactOperation('greeting')]
    public function greeting(GreetingInput $input): GreetingResult
    {
        return new GreetingResponse200(new Greeting($input->principal() !== null));
    }

    #[SeampactOperation('strictGreeting')]
    public function strictGreeting(StrictGreetingInput $input): StrictGreetingResult
    {
        return new StrictGreetingResponse200(new Greeting($input->principal() !== null));
    }
}
