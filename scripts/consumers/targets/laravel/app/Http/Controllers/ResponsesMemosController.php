<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\TasksResponses\DeleteMemoErrors;
use App\Generated\TasksResponses\DeleteMemoRequest;
use App\Generated\TasksResponses\DeleteMemoResponse204;
use App\Generated\TasksResponses\DeleteMemoResult;
use App\Generated\TasksResponses\GetMemoRequest;
use App\Generated\TasksResponses\GetMemoResponse200;
use App\Generated\TasksResponses\GetMemoResult;
use App\Generated\TasksResponses\MemosEndpoints;
use App\Generated\TasksResponses\Schemas\Memo;

/** The `tasksResponses` api's memos: one memo at its first version, which a delete with another expected version leaves. */
final class ResponsesMemosController implements MemosEndpoints
{
    private const FIRST_MEMO_VERSION = 1;
    private const FIRST_MEMO_TEXT = 'The first memo';

    public function getMemo(GetMemoRequest $request): GetMemoResult
    {
        return new GetMemoResponse200(new Memo($request->contractInput()->path->memoId, self::FIRST_MEMO_TEXT, self::FIRST_MEMO_VERSION));
    }

    public function deleteMemo(DeleteMemoRequest $request): DeleteMemoResult
    {
        if ($request->contractInput()->query->expectedVersion !== self::FIRST_MEMO_VERSION) {
            return DeleteMemoErrors::stateConflict();
        }

        return new DeleteMemoResponse204();
    }
}
