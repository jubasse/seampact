<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Generated\Tasks\DeleteDraftResponse200;
use App\Generated\Tasks\DeleteDraftResult;
use App\Generated\Tasks\DraftsEndpoints;
use App\Generated\Tasks\GetDraftResponse200;
use App\Generated\Tasks\GetDraftResult;
use App\Generated\Tasks\DeleteDraftRequest;
use App\Generated\Tasks\GetDraftRequest;
use Seampact\ConsumerSuite\SampleData;

final class DraftsController implements DraftsEndpoints
{
    public function getDraft(GetDraftRequest $request): GetDraftResult
    {
        return new GetDraftResponse200(SampleData::draft($request->contractInput()->path->draftId));
    }

    public function deleteDraft(DeleteDraftRequest $request): DeleteDraftResult
    {
        return new DeleteDraftResponse200(SampleData::draft($request->contractInput()->path->draftId));
    }
}
