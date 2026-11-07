package com.example.consumer;

import com.example.tasksoptionalauth.api.GreetingInput;
import com.example.tasksoptionalauth.api.GreetingResult;
import com.example.tasksoptionalauth.api.StrictGreetingInput;
import com.example.tasksoptionalauth.api.StrictGreetingResult;
import com.example.tasksoptionalauth.api.WelcomeEndpoints;
import com.example.tasksoptionalauth.api.schemas.Greeting;
import com.example.tasksoptionalauth.api.spring.StrictGreeting;
import org.springframework.web.bind.annotation.RestController;

/** The `tasksOptionalAuth` api's controller: a caller is signed in when the boundary hands it a principal. */
@RestController
final class TasksOptionalAuthControllers implements WelcomeEndpoints {
    @Override
    @com.example.tasksoptionalauth.api.spring.Greeting
    public GreetingResult greeting(GreetingInput input) {
        return new GreetingResult.Status200(new Greeting(input.principal() != null));
    }

    @Override
    @StrictGreeting
    public StrictGreetingResult strictGreeting(StrictGreetingInput input) {
        return new StrictGreetingResult.Status200(new Greeting(input.principal() != null));
    }
}
