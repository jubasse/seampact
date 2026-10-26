<?php

declare(strict_types=1);

// The run-time settings of api 'tasks', read as config('seampact.tasks.*'); an operation's own settings go under 'operations'.
return [
    'responses' => env('SEAMPACT_TASKS_RESPONSES', 'strict'),
    'body_validation' => env('SEAMPACT_TASKS_BODY_VALIDATION', false),
    'framework_etag' => env('SEAMPACT_TASKS_FRAMEWORK_ETAG', 'strip'),
    'catch_all' => env('SEAMPACT_TASKS_CATCH_ALL', true),
    'public_origin' => env('SEAMPACT_TASKS_PUBLIC_ORIGIN'),
    'middleware' => [
        'public' => [],
        'optional' => [],
        'identity' => [],
        'signed' => [],
    ],
];
