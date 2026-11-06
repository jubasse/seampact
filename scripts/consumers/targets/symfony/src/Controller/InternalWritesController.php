<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksServiceWrites\CreateTaskInput;
use App\Generated\TasksServiceWrites\CreateTaskResponse201;
use App\Generated\TasksServiceWrites\CreateTaskResult;
use App\Generated\TasksServiceWrites\InternalWritesEndpoints;
use App\Generated\TasksServiceWrites\Symfony\SeampactOperation;
use Seampact\ConsumerSuite\SampleData;

/** The `tasksServiceWrites` api's controller: the relayed write creates the task it is given. */
final class InternalWritesController implements InternalWritesEndpoints
{
    #[SeampactOperation('createTask')]
    public function createTask(CreateTaskInput $input): CreateTaskResult
    {
        return new CreateTaskResponse201(SampleData::relayedTask($input->body->title, $input->body->effort));
    }
}
