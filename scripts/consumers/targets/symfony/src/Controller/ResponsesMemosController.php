<?php

declare(strict_types=1);

namespace App\Controller;

use App\Generated\TasksResponses\DeleteMemoErrors;
use App\Generated\TasksResponses\DeleteMemoInput;
use App\Generated\TasksResponses\DeleteMemoResponse204;
use App\Generated\TasksResponses\DeleteMemoResult;
use App\Generated\TasksResponses\GetMemoInput;
use App\Generated\TasksResponses\GetMemoResponse200;
use App\Generated\TasksResponses\GetMemoResult;
use App\Generated\TasksResponses\MemosEndpoints;
use App\Generated\TasksResponses\Schemas\Memo;
use App\Generated\TasksResponses\Symfony\SeampactOperation;

/** The `tasksResponses` api's memos: one memo at its first version, which a delete with another expected version leaves. */
final class ResponsesMemosController implements MemosEndpoints
{
    private const FIRST_MEMO_VERSION = 1;
    private const FIRST_MEMO_TEXT = 'The first memo';

    #[SeampactOperation('getMemo')]
    public function getMemo(GetMemoInput $input): GetMemoResult
    {
        return new GetMemoResponse200(new Memo($input->path->memoId, self::FIRST_MEMO_TEXT, self::FIRST_MEMO_VERSION));
    }

    #[SeampactOperation('deleteMemo')]
    public function deleteMemo(DeleteMemoInput $input): DeleteMemoResult
    {
        if ($input->query->expectedVersion !== self::FIRST_MEMO_VERSION) {
            return DeleteMemoErrors::stateConflict();
        }

        return new DeleteMemoResponse204();
    }
}
