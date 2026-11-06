<?php

declare(strict_types=1);

return [
    App\Generated\Tasks\Laravel\TasksSeampactServiceProvider::class,
    App\Generated\TasksService\Laravel\TasksServiceSeampactServiceProvider::class,
    App\Generated\TasksServiceWrites\Laravel\TasksServiceWritesSeampactServiceProvider::class,
    App\Generated\TasksDevices\Laravel\TasksDevicesSeampactServiceProvider::class,
    App\Generated\TasksOptionalAuth\Laravel\TasksOptionalAuthSeampactServiceProvider::class,
    App\Generated\TasksAbsoluteUrls\Laravel\TasksAbsoluteUrlsSeampactServiceProvider::class,
    App\Generated\TasksPaging\Laravel\TasksPagingSeampactServiceProvider::class,
    App\Generated\TasksSplitSort\Laravel\TasksSplitSortSeampactServiceProvider::class,
    App\Providers\SuiteServiceProvider::class,
    App\Providers\PagingServiceProvider::class,
];
