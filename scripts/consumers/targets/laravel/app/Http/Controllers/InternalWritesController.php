<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksServiceWrites\CreateTaskRequest;
use App\Generated\TasksServiceWrites\CreateTaskResponse201;
use App\Generated\TasksServiceWrites\CreateTaskResult;
use App\Generated\TasksServiceWrites\InternalWritesEndpoints;
use Seampact\ConsumerSuite\SampleData;

/** The `tasksServiceWrites` api's controller: the relayed write creates the task it is given. */
final class InternalWritesController implements InternalWritesEndpoints
{
    public function createTask(CreateTaskRequest $request): CreateTaskResult
    {
        $body = $request->contractInput()->body;

        return new CreateTaskResponse201(SampleData::relayedTask($body->title, $body->effort));
    }
}
