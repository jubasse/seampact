<?php

declare(strict_types=1);

use App\Http\Middleware\NativeLayers;

// The app's own middleware on the tasks api's identity routes only (`seampact.tasks.middleware.identity`).
return [
    'middleware' => [
        'identity' => [NativeLayers::class],
    ],
];
