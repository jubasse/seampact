<?php

declare(strict_types=1);

// The run-time settings of api 'tasks', read as config('seampact.tasks.*'); an operation's own settings go under 'operations'.
return [
    'responses' => env('SEAMPACT_TASKS_RESPONSES', \Seampact\Golden\Tasks\Laravel\TasksRoutes::DEFAULTS['responses']),
    'body_validation' => env('SEAMPACT_TASKS_BODY_VALIDATION', \Seampact\Golden\Tasks\Laravel\TasksRoutes::DEFAULTS['body_validation']),
    'framework_etag' => env('SEAMPACT_TASKS_FRAMEWORK_ETAG', \Seampact\Golden\Tasks\Laravel\TasksRoutes::DEFAULTS['framework_etag']),
    'catch_all' => env('SEAMPACT_TASKS_CATCH_ALL', \Seampact\Golden\Tasks\Laravel\TasksRoutes::DEFAULTS['catch_all']),
    'public_origin' => env('SEAMPACT_TASKS_PUBLIC_ORIGIN'),
    'middleware' => [
        'public' => [],
        'optional' => [],
        'identity' => [],
        'signed' => [],
    ],
];
